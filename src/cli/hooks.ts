import { claudeProjectDir, claudeStateDir, claudeToolPrefix } from '../adapters/claude';
import { WORKSPACE_KEY, readBinding } from '../core/binding';
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

type Resolved = { ctx: Ctx; directory: string; stateDir: string };

function resolve(input: HookInput, deps: HookDeps): Resolved {
  const env = deps.env ?? process.env;
  const directory = deps.cwd ?? (input.cwd?.trim() || claudeProjectDir(env));
  const stateDir = deps.stateDir ?? claudeStateDir(env);
  const ctx =
    deps.ctx ??
    createCtx({
      directory,
      env,
      toolPrefix: claudeToolPrefix(env),
      stateDir,
    });
  return { ctx, directory, stateDir };
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
 * Contexto do turno a partir do vinculo do workspace. Sem vinculo nao ha o que
 * injetar, e o hook devolve nada em vez de um texto vazio.
 */
export async function contextHook(
  input: HookInput,
  deps: HookDeps = {}
): Promise<HookOutput | undefined> {
  const { ctx, directory, stateDir } = resolve(input, deps);
  const b = readBinding(directory, WORKSPACE_KEY, stateDir);
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
