import {
  claudeBindingKey,
  claudeProjectDir,
  claudeStateDir,
  claudeToolPrefix,
} from '../adapters/claude';
import { claudePid, trackSession } from '../adapters/claude-session';
import { readBinding } from '../core/binding';
import { createCtx, type Ctx } from '../core/context';
import { buildSystemHead } from '../core/session';
import { isRealPush } from '../tools/pipeline';
import { createPushHook } from '../tools/push-hook';

/**
 * Os hooks do Claude Code. Cada um recebe o evento em JSON no stdin e devolve
 * `additionalContext`, que o host injeta ao lado do que aconteceu.
 *
 * Texto do modelo e casamento de nome de tool ficam aqui. O trabalho em si e o
 * mesmo das tools, entao nada e reimplementado: o push reaproveita
 * `createPushHook` e o contexto reaproveita `buildSystemHead`.
 */

export type HookInput = {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { command?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

export type HookOutput = {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
};

export type HookDeps = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Onde mora o vinculo. Sem isso, `PYATILETKA_STATE_DIR` ou o padrao. */
  stateDir?: string;
  /** Ctx pronto, para teste sem rede. Sem ele, o hook monta um do ambiente. */
  ctx?: Ctx;
};

/**
 * `directory` e onde o evento aconteceu (o push roda ali). `projectDir` e a raiz
 * do projeto, a mesma chave com que o servidor MCP grava o vinculo.
 */
type Resolved = {
  ctx: Ctx;
  directory: string;
  projectDir: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
};

function resolve(input: HookInput, deps: HookDeps): Resolved {
  const env = deps.env ?? process.env;
  const directory = deps.cwd ?? (input.cwd?.trim() || claudeProjectDir(env));
  const projectDir = deps.cwd ?? claudeProjectDir(env, input.cwd?.trim() || process.cwd());
  const stateDir = deps.stateDir ?? claudeStateDir(env);
  const ctx =
    deps.ctx ??
    createCtx({
      directory,
      env,
      toolPrefix: claudeToolPrefix(env),
      stateDir,
    });
  return { ctx, directory, projectDir, stateDir, env };
}

function hookOut(input: HookInput, text: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: input.hook_event_name ?? 'SessionStart',
      additionalContext: text,
    },
  };
}

/**
 * Contexto do turno a partir do vinculo da sessao. Sem vinculo nao ha o que
 * injetar, e o hook devolve nada em vez de um texto vazio.
 */
export async function contextHook(
  input: HookInput,
  deps: HookDeps = {}
): Promise<HookOutput | undefined> {
  const { ctx, projectDir, stateDir, env } = resolve(input, deps);
  // O stdin traz a sessao atual. O ambiente pode estar no valor de antes do `/clear`.
  const session = input.session_id?.trim() || claudeBindingKey(env);
  const pid = claudePid(env);
  if (pid && input.session_id?.trim()) trackSession(projectDir, stateDir, pid, session);
  const b = readBinding(projectDir, session, stateDir);
  if (!b) return undefined;
  return hookOut(input, await buildSystemHead(ctx, b));
}

/**
 * Depois de um `git push`, espera o CI e devolve o veredito no mesmo turno.
 * O `hooks.json` ja filtra por `Bash(git push *)`, mas o comando ainda passa
 * por `isRealPush`: o filtro do host e melhor esforco.
 */
export async function pushHook(
  input: HookInput,
  deps: HookDeps = {}
): Promise<HookOutput | undefined> {
  if (input.tool_name && input.tool_name !== 'Bash') return undefined;
  const cmd = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
  if (!isRealPush(cmd)) return undefined;

  const { ctx, directory } = resolve(input, deps);
  const push = createPushHook({ ctx, directory });
  const out = { output: '' };
  await push({ tool: 'bash', args: { command: cmd } }, out);
  const text = out.output.trim();
  return text ? hookOut(input, text) : undefined;
}

export const HOOKS = {
  context: contextHook,
  push: pushHook,
} as const;

export type HookName = keyof typeof HOOKS;
