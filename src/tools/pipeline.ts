import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { errorLines } from '../core/logs';
import { branchOf, dur, fmtRun, isActive, runState } from '../core/format';
import { expandRepos, parseRef, pickRepo, type Ctx } from '../core/context';
import type { Run } from '../providers/types';

/**
 * Tools de pipeline. `ci_wait` bloqueia dentro da chamada em vez de deixar o
 * agente dormir e checar de novo, e o hook de `tool.execute.after` faz o mesmo
 * depois de um `git push`.
 */

const DEFAULT_TIMEOUT_MS = 900_000;
const POLL_MS = 6_000;

export type PipelineToolsInput = {
  ctx: Ctx;
  /** Branch usada quando o pedido nao informa. Vazia = ultima execucao do repo. */
  defaultBranch?: string;
};

const repoArg = (ctx: Ctx) =>
  tool.schema
    .string()
    .optional()
    .describe(
      ctx.defaultRepo
        ? `Slug do repo (default ${ctx.defaultRepo})`
        : 'Slug do repo no formato owner/nome'
    );

/** Ultima execucao de um repo, opcionalmente de uma branch. */
export async function latestRun(ctx: Ctx, repo: string, branch?: string): Promise<Run | undefined> {
  const runs = await ctx.host.listRuns(repo, { branch, limit: 1 });
  return runs[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera o run chegar em estado terminal. O usuario pode cancelar a sessao. */
export async function waitRun(
  ctx: Ctx,
  repo: string,
  id: number,
  timeoutMs: number
): Promise<{ run: Run; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await ctx.host.getRun(repo, id);
    if (!isActive(run.status)) return { run, timedOut: false };
    if (Date.now() >= deadline) return { run, timedOut: true };
    await sleep(POLL_MS);
  }
}

/** Branch de destino de um `git push`, ou undefined quando nao da para ler. */
export function pushedBranch(cmd: string): string | undefined {
  return (
    cmd
      .match(/push\s+(?:--?[\w-]+(?:=\S+)?\s+)*(?:origin\s+)?\w+:(\S+)/)?.[1]
      ?.replace(/^refs\/heads\//, '') ??
    cmd.match(/push\s+(?:--?[\w-]+(?:=\S+)?\s+)*origin\s+(\S+)/)?.[1]?.replace(/^refs\/heads\//, '')
  );
}

/** O comando e um push de verdade (sem dry-run e sem force). */
export function isRealPush(cmd: string): boolean {
  if (!/(^|[;&|]\s*)git\s+push\b/.test(cmd)) return false;
  return !/--dry-run|--force|--force-with-lease|\s-f\s/.test(cmd);
}

export function pipelineTools({
  ctx,
  defaultBranch = '',
}: PipelineToolsInput): Record<string, ToolDefinition> {
  const repoArgHere = repoArg(ctx);
  const resolve = (arg?: string) => pickRepo(ctx, arg);

  return {
    ci_runs: tool({
      description:
        'Lista execucoes do CI. Com `repo`, so aquele repo; com `repos` (lista ou glob), varios; sem nada, visao geral da org.',
      args: {
        repo: repoArgHere,
        repos: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Slugs para visao multi-repo; aceita glob. Ignorado se `repo` vier.'),
        branch: tool.schema.string().optional(),
        event: tool.schema
          .enum(['push', 'pull_request', 'workflow_dispatch', 'schedule', 'tag'])
          .optional(),
        active: tool.schema
          .boolean()
          .optional()
          .describe('So execucoes em andamento (queued/in_progress/waiting).'),
        limit: tool.schema.number().optional().describe('Max por repo (default 10).'),
      },
      async execute(args) {
        const limit = args.limit ?? 10;
        const single = args.repo ?? (args.repos?.length ? undefined : ctx.defaultRepo);

        const one = async (repo: string) => ({
          repo,
          runs: await ctx.host.listRuns(repo, {
            branch: args.branch,
            event: args.event,
            active: args.active,
            limit,
          }),
        });

        if (single) {
          const repo = resolve(single);
          const { runs } = await one(repo);
          if (!runs.length) return `Nenhuma execucao em ${repo}.`;
          return [
            '#      estado                   branch      dur    titulo',
            ...runs.map(fmtRun),
          ].join('\n');
        }

        const repos = await expandRepos(ctx, args.repos);
        const blocks: string[] = [];
        let activeCount = 0;
        for (const repo of repos) {
          const { runs } = await one(repo).catch(() => ({ repo, runs: [] as Run[] }));
          if (args.active) activeCount += runs.length;
          const showing = args.active ? runs : runs.slice(0, 1);
          if (!showing.length) continue;
          blocks.push(
            `${repo} ${'-'.repeat(Math.max(0, 46 - repo.length))}\n${showing.map(fmtRun).join('\n')}`
          );
        }
        if (!blocks.length) {
          return args.active ? 'Nenhuma execucao em andamento.' : 'Nenhuma execucao encontrada.';
        }
        return `${args.active ? `${activeCount} em andamento\n` : ''}${blocks.join('\n\n')}`;
      },
    }),

    ci_run: tool({
      description:
        'Detalhe de uma execucao: estado, conclusao, duracao, commit, branch e link. Inclui os status de CI do commit quando a execucao vem de um PR.',
      args: {
        run: tool.schema.string().describe('ID da execucao (ex.: 5798).'),
        repo: repoArgHere,
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const id = parseRef(args.run);
        if (!Number.isFinite(id)) throw new Error(`execucao invalida: ${args.run}`);
        const run = await ctx.host.getRun(repo, id);
        const lines = [
          `${repo} run #${run.id}${run.runNumber ? ` (nº ${run.runNumber})` : ''} - ${runState(run)} em ${dur(run)}`,
          `  titulo:    ${run.title ?? '?'}`,
          `  evento:    ${run.event ?? '?'}`,
          `  workflow:  ${run.path ?? '?'}`,
          `  branch:    ${branchOf(run)}`,
          `  sha:       ${run.sha ?? '?'}`,
          `  janela:    ${run.startedAt ?? '?'} -> ${run.completedAt ?? '(em andamento)'}  [${dur(run)}]`,
          `  url:       ${run.url ?? ''}`,
        ];

        if (run.sha && !isActive(run.status)) {
          const checks = await ctx.host.getChecks(repo, run.sha).catch(() => undefined);
          if (checks?.statuses.length) {
            lines.push(
              `  CI do commit: ${checks.overall}`,
              ...checks.statuses.map((s) =>
                `    - ${s.context}: ${s.status} ${s.description ?? ''}`.trimEnd()
              )
            );
          }
        }
        return lines.filter(Boolean).join('\n');
      },
    }),

    ci_wait: tool({
      description:
        'BLOQUEIA ate a execucao chegar em estado terminal (completed/failure/cancelled) ou ate `timeout_ms`. Use depois de um push em vez de `sleep N && ...` em loop. Em falha, devolve as linhas de erro do log. Informe `run` ou `branch`: sem os dois, nao ha como saber qual execucao esperar.',
      args: {
        repo: repoArgHere,
        run: tool.schema
          .string()
          .optional()
          .describe(
            'ID da execucao. Se omitido e `branch` vier, espera a mais recente dessa branch.'
          ),
        branch: tool.schema.string().optional().describe('Branch a aguardar.'),
        timeout_ms: tool.schema
          .number()
          .optional()
          .describe(`Timeout em ms (default ${DEFAULT_TIMEOUT_MS}, ou seja 15min). Min 30s.`),
        logs_on_failure: tool.schema
          .boolean()
          .optional()
          .describe('Anexar linhas de erro do log quando falhar (default true).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const timeoutMs = Math.max(30_000, args.timeout_ms ?? DEFAULT_TIMEOUT_MS);
        const branch = args.branch ?? defaultBranch;

        if (!args.run && !branch) {
          throw new Error(
            `Informe \`run\` (id da execucao) ou \`branch\`. Sem os dois nao da para saber qual execucao esperar em ${repo}.`
          );
        }

        let id = args.run ? parseRef(args.run) : NaN;
        if (!Number.isFinite(id)) {
          const found = await latestRun(ctx, repo, branch);
          if (!found) {
            throw new Error(
              `Nenhuma execucao em ${repo} para a branch ${branch}. O workflow disparou?`
            );
          }
          id = found.id;
        }

        const pre = await ctx.host.getRun(repo, id);
        ctx.notify(
          isActive(pre.status)
            ? `Aguardando ${repo} run #${id}`
            : `Run #${id} ja terminou: ${pre.conclusion}`
        );

        const { run, timedOut } = await waitRun(ctx, repo, id, timeoutMs);

        if (timedOut) {
          return [
            `timeout apos ${Math.round(timeoutMs / 1000)}s - ${repo} run #${run.id} ainda em ${run.status}`,
            `  branch: ${branchOf(run)}  sha: ${(run.sha ?? '').slice(0, 7)}`,
            '  Isso nao e falha: o runner pode estar ocupado, offline, ou o job ainda em espera.',
            '  Proximo passo: `ci_run` para o estado e `ci_runners` para o runner, ou `ci_wait` de novo para estender.',
          ].join('\n');
        }

        const ok = run.conclusion === 'success';
        const head = [
          `${ok ? 'OK' : 'FALHOU'} ${repo} run #${run.id} - ${run.status}/${run.conclusion ?? '?'} em ${dur(run)}`,
          `  ${run.title ?? run.path ?? ''}`,
          `  ${run.url ?? ''}`,
        ];

        if (!ok && (args.logs_on_failure ?? true)) {
          const log = await ctx.host.getRunLogs(repo, run.id, {}).catch(() => '');
          const errs = errorLines(log);
          if (errs.length) {
            head.push(`\n--- linhas de erro (ultimas ${errs.length}) ---`, ...errs);
            head.push('\n(Use `ci_logs` com step/grep para o contexto completo.)');
          }
        }
        ctx.notify(
          `Run #${run.id} ${repo}: ${ok ? 'ok' : (run.conclusion ?? 'falhou')}`,
          ok ? 'success' : 'error'
        );
        return head.join('\n');
      },
    }),

    ci_logs: tool({
      description:
        'Log de uma execucao. No Gitea isso usa o binario `tea` por baixo, porque a REST nao expoe o log do run. Default: so linhas de erro, que e o barato. `full:true` traz o log inteiro; `step`, `grep` e `tail` filtram.',
      args: {
        run: tool.schema.string().describe('ID da execucao.'),
        repo: repoArgHere,
        full: tool.schema
          .boolean()
          .optional()
          .describe('Log completo em vez de so linhas de erro.'),
        step: tool.schema
          .string()
          .optional()
          .describe('Filtra pelo nome do job (o log traz cabecalho `Job: <nome> (ID: n)`).'),
        grep: tool.schema.string().optional().describe('Regex case-insensitive linha a linha.'),
        tail: tool.schema.number().optional().describe('Ultimas N linhas (default 200).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const id = parseRef(args.run);
        if (!Number.isFinite(id)) throw new Error(`execucao invalida: ${args.run}`);
        return ctx.host.getRunLogs(repo, id, {
          full: args.full,
          step: args.step,
          grep: args.grep,
          tail: args.tail,
        });
      },
    }),

    ci_config: tool({
      description:
        'Configuracao de CI de um repo: todas as variaveis e a lista de secrets (nunca os valores), mais os workflows disponiveis para dispatch. Uma chamada substitui N chamadas para ler variavel por variavel.',
      args: { repo: repoArgHere },
      async execute(args) {
        const repo = resolve(args.repo);
        const cfg = await ctx.host.getActionsConfig(repo);
        const lines = [`${repo} - CI`];

        lines.push(
          cfg.variables.length
            ? `\nvariables (${cfg.variables.length}):\n${cfg.variables
                .map((v) => {
                  const detail =
                    (v.lines ?? 0) > 1 || (v.chars ?? 0) > 60
                      ? ` [${v.lines ?? 1} linhas, ${v.chars ?? 0} chars]`
                      : '';
                  return `  ${v.name}=${(v.value ?? '').slice(0, 60)}${detail}`;
                })
                .sort()
                .join('\n')}`
            : '\nvariables: (nenhuma ou sem permissao)'
        );

        lines.push(
          cfg.secrets.length
            ? `\nsecrets (${cfg.secrets.length}, valores ocultos): ${[...cfg.secrets].sort().join(', ')}`
            : '\nsecrets: (nenhum ou sem permissao)'
        );

        lines.push(
          cfg.workflows.length
            ? `\nworkflows:\n${cfg.workflows
                .map(
                  (w) =>
                    `  ${w.id}${w.state && w.state !== 'active' ? ` [${w.state}]` : ''} - ${w.name}`
                )
                .join('\n')}\n  (dispatch por id; \`ci_dispatch\` aceita o id ou o nome do arquivo)`
            : '\nworkflows: (nenhum ou sem permissao)'
        );

        return lines.join('\n');
      },
    }),

    ci_dispatch: tool({
      description:
        'Dispara um workflow manualmente. `inputs` sao pares chave/valor; confirme os nomes validos com `ci_config` antes.',
      args: {
        repo: repoArgHere,
        workflow: tool.schema.string().describe('Nome ou arquivo do workflow (ex.: deploy.yml).'),
        ref: tool.schema.string().optional().describe('Branch ou tag do dispatch.'),
        inputs: tool.schema
          .record(tool.schema.string(), tool.schema.string())
          .optional()
          .describe('Ex.: { "ambiente": "producao", "confirmar": "SIM" }'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const ref = args.ref ?? defaultBranch;
        if (!ref) throw new Error('Informe `ref` (branch ou tag) do dispatch.');
        await ctx.host.dispatchWorkflow(repo, args.workflow, ref, args.inputs);
        ctx.notify(`Workflow ${args.workflow} disparado em ${repo}`, 'success');
        const run = await latestRun(ctx, repo, ref).catch(() => undefined);
        return [
          `Dispatch aceito: ${args.workflow} @ ${ref} em ${repo}`,
          run
            ? `Run gerado: #${run.id} (${run.status}/${run.conclusion ?? '?'}). Use \`ci_wait\` para acompanhar.`
            : 'Nenhuma execucao visivel ainda; valide com `ci_runs` em alguns segundos.',
        ].join('\n');
      },
    }),

    ci_runners: tool({
      description:
        'Runner(s) de CI do repo ou da org: online ou offline, busy e labels. Use quando um run fica queued sem comecar.',
      args: { repo: repoArgHere },
      async execute(args) {
        const repo = resolve(args.repo);
        const runners = await ctx.host.listRunners(repo);
        if (!runners.length) return `Nenhum runner registrado para ${repo}.`;
        return [
          `${runners.length} runner(s):`,
          ...runners.map((r) => {
            const state = r.status !== 'online' ? '!' : r.busy ? '>' : '-';
            const labels = r.labels?.join(', ') || '(sem label)';
            return `  ${state} ${r.name.padEnd(12)} ${r.status.padEnd(8)} busy=${String(r.busy).padEnd(5)} labels: ${labels}`;
          }),
        ].join('\n');
      },
    }),
  };
}

export type { Run };
