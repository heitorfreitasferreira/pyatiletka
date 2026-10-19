import {
  claudeProjectDir,
  claudeSessionID,
  claudeStateDir,
  claudeToolPrefix,
} from '../adapters/claude';
import { workspaceBinding } from '../core/binding';
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
};

/**
 * Texto que acompanha a lista de tools. E o unico lugar sempre visivel ao
 * modelo, entao carrega a regra que nao pode faltar.
 */
export function instructions(prefix: string): string {
  return (
    'Tools de fluxo de issue, marco, PR e CI (Gitea e GitHub). ' +
    `Antes de trabalhar em uma issue, chame ${toolRef(prefix, 'issue_bind')}: ` +
    'o vinculo vale para o projeto inteiro e toda conversa passa a receber o corpo ' +
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

  const binding = workspaceBinding(directory, stateDir);
  const specs = createToolSpecs({ ctx, directory, binding });
  const sessionID = claudeSessionID(env);

  const handler: Handler = {
    specs,
    version: VERSION,
    instructions: instructions(prefix),
    run: (spec, args) => spec.execute(args, { sessionID }),
  };

  return { handler, ctx, directory };
}

export const SERVER_INFO = { name: SERVER_NAME, version: VERSION };
