import { errorLines } from '../core/logs';
import type { Ctx } from '../core/context';
import { isRealPush, latestRun, pushedBranch, waitRun } from './pipeline';

/**
 * Espera automatica depois de um `git push`.
 *
 * A regra do fluxo e nao tratar push como concluido ate o CI ficar verde. Em vez
 * de o agente dormir e checar, o push espera aqui e o veredito volta no mesmo
 * turno, com as linhas de erro do log quando falha.
 */

const DEFAULT_TIMEOUT_MS = 900_000;
/** O webhook as vezes demora segundos para registrar o run. */
const APPEAR_TRIES = 6;
const APPEAR_WAIT_MS = 2500;

export type PushHookInput = {
  ctx: Ctx;
  directory: string;
  timeoutMs?: number;
  /** Injeta o sleep, para o teste nao esperar de verdade. */
  wait?: (ms: number) => Promise<void>;
};

export type PushHook = (
  input: { tool: string; args?: unknown },
  output: { output: string }
) => Promise<void>;

/**
 * Procura o repo que o push atingiu: `git -C <dir>`, depois `cd <dir>`, senao
 * o `directory` do workspace.
 */
export function pushedRepo(cmd: string, directory: string): string | undefined {
  const explicit = cmd.match(/git\s+-C\s+("[^"]+"|'[^']+'|\S+)/)?.[1]?.replace(/^["']|["']$/g, '');
  const cdDir = cmd.match(/cd\s+("[^"]+"|'[^']+'|\S+)/)?.[1]?.replace(/^["']|["']$/g, '');
  return explicit ?? cdDir ?? directory;
}

export function createPushHook({
  ctx,
  directory,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  wait,
}: PushHookInput): PushHook {
  const pause = wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async (input, output) => {
    if (input.tool !== 'bash') return;
    const cmd = String((input.args as { command?: string })?.command ?? '');
    if (!isRealPush(cmd)) return;

    const repo = resolvePushed(ctx, cmd, directory);
    if (!repo) return;
    const shortName = repo.split('/')[1] ?? repo;

    // Repo sem CI configurado nao gera execucao nenhuma: nao ha o que esperar.
    const cfg = await ctx.host.getActionsConfig(repo).catch(() => undefined);
    if (!cfg?.workflows.length) return;

    const branch = pushedBranch(cmd);
    let run = await latestRun(ctx, repo, branch);
    for (let i = 0; i < APPEAR_TRIES && !run; i++) {
      await pause(APPEAR_WAIT_MS);
      run = await latestRun(ctx, repo, branch);
    }
    if (!run) return;

    ctx.notify(`push em ${shortName}: aguardando run #${run.id}`);
    const { run: done, timedOut } = await waitRun(ctx, repo, run.id, timeoutMs);

    if (timedOut) {
      output.output +=
        `\n\n[pipeline] ainda ${done.status} apos ${Math.round(timeoutMs / 60_000)}min: o CI nao confirmou. ` +
        `Verifique com \`ci_run\`.`;
      ctx.notify(`Pipeline ${shortName} #${done.id} ainda ${done.status}`, 'warning');
      return;
    }

    if (done.conclusion === 'success') {
      output.output += `\n\n[pipeline] ${shortName} run #${done.id} verde: o push foi confirmado pelo CI.`;
      ctx.notify(`Pipeline ${shortName} #${done.id} verde`, 'success');
      return;
    }

    const log = await ctx.host.getRunLogs(repo, done.id, {}).catch(() => '');
    const errs = errorLines(log);
    output.output +=
      `\n\n[pipeline] ${shortName} run #${done.id} ${done.conclusion}: o push NAO passou pelo CI.\n` +
      `${errs.length ? errs.map((l) => `  ${l}`).join('\n') : '  (use `ci_logs` para ver o log)'}\n` +
      `  ${done.url ?? ''}`;
    ctx.notify(`Pipeline ${shortName} #${done.id} ${done.conclusion}`, 'error');
  };
}

/** `resolvePushed` no caminho alvo do push, caindo no remote do workspace. */
function resolvePushed(ctx: Ctx, cmd: string, directory: string): string | undefined {
  const target = pushedRepo(cmd, directory);
  const fallback = ctx.remote ?? ctx.defaultRepo;
  if (!target || target === directory) return fallback;
  const name = target.split('/').filter(Boolean).pop();
  if (!name) return fallback;
  return ctx.config.org ? `${ctx.config.org}/${name}` : name;
}
