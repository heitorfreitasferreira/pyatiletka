import {
  claudeBindingKey,
  claudeProjectDir,
  claudeStateDir,
  claudeToolPrefix,
} from '../adapters/claude';
import { currentSession, parentPid, type ParentOf } from '../adapters/claude-session';
import { fileBinding } from '../core/binding';
import { createCtx, type Ctx } from '../core/context';
import { createToolSpecs } from '../tools/factory';
import { toolRef } from '../tools/spec';
import { VERSION } from '../version';
import { SERVER_NAME, type Handler } from './protocol';

/**
 * Monta o servidor a partir do ambiente que o Claude Code deixa no processo.
 * As tools sao as mesmas do plugin: `createToolSpecs` nao sabe quem chamou.
 */

export type ServerInput = {
  /** Raiz do projeto. Sem ela, `CLAUDE_PROJECT_DIR` ou o diretorio atual. */
  directory?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Processo de onde sobe a busca pela sessao atual. Default: este. */
  pid?: number;
  parentOf?: ParentOf;
};

/**
 * Texto que acompanha a lista de tools. E o unico lugar sempre visivel ao
 * modelo, entao carrega a regra que nao pode faltar.
 */
export function instructions(prefix: string): string {
  return (
    'Tools de fluxo de issue, marco, PR e CI (Gitea e GitHub). ' +
    `Antes de trabalhar em uma issue, chame ${toolRef(prefix, 'issue_bind')}: ` +
    'o vinculo vale para esta sessao e toda conversa dela passa a receber o corpo ' +
    'e os comentarios da issue. ' +
    'Titulo e corpo de issue, comentario e descricao de PR passam pela checagem ' +
    'de prosa, que recusa travessao, ponto e virgula em prosa e frase de formula.'
  );
}

export function createHandler(input: ServerInput = {}): {
  handler: Handler;
  ctx: Ctx;
  directory: string;
} {
  const env = input.env ?? process.env;
  const directory = input.directory ?? claudeProjectDir(env, input.cwd);
  const stateDir = claudeStateDir(env);
  const prefix = claudeToolPrefix(env);

  const ctx = createCtx({
    directory,
    env,
    toolPrefix: prefix,
    stateDir,
  });

  const binding = fileBinding(directory, stateDir);
  const specs = createToolSpecs({ ctx, directory, binding });
  const pid = input.pid ?? process.pid;
  const parentOf = input.parentOf ?? parentPid;
  // Resolvida a cada chamada: depois de `/clear` o hook aponta a sessao nova.
  const sessionID = (): string =>
    currentSession(directory, stateDir, pid, parentOf) ?? claudeBindingKey(env);

  const handler: Handler = {
    specs,
    version: VERSION,
    instructions: instructions(prefix),
    run: (spec, args) => spec.execute(args, { sessionID: sessionID() }),
  };

  return { handler, ctx, directory };
}

export const SERVER_INFO = { name: SERVER_NAME, version: VERSION };
