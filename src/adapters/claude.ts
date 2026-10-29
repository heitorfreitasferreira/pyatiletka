import { join } from 'node:path';
import { WORKSPACE_KEY } from '../core/binding';

/**
 * Adaptador do Claude Code. O host nao chama funcao nossa no processo dele: as
 * tools chegam por um servidor MCP e os hooks por comando de shell. O que os
 * dois precisam saber (projeto, estado, sessao) vem do ambiente, que o Claude
 * Code popula em todo processo que sobe.
 *
 * `CLAUDE_PROJECT_DIR` chega no servidor MCP stdio e no processo de hook.
 * `CLAUDE_PLUGIN_DATA` so existe quando o servidor vem de dentro do plugin.
 * `CLAUDE_CODE_SESSION_ID` chega no servidor MCP e no hook, e cada sessao sobe
 * o proprio servidor. O vinculo e da sessao. Ver `claudeBindingKey`.
 */

/**
 * Como o Claude Code apresenta uma tool de um servidor que vem de dentro do
 * plugin: `mcp__plugin_<plugin>_<servidor>__<tool>`. O plugin se chama
 * pyatiletka e o servidor tambem, entao o prefixo sai do nome repetido.
 *
 * Quem declara o servidor no proprio `.mcp.json` (fora do plugin) recebe
 * `mcp__pyatiletka__`, e ajusta `PYATILETKA_TOOL_PREFIX` para o texto que o
 * agente le apontar o nome certo.
 */
export const CLAUDE_TOOL_PREFIX = 'mcp__plugin_pyatiletka_pyatiletka__';

/** Prefixo efetivo do nome das tools no host. */
export function claudeToolPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return env.PYATILETKA_TOOL_PREFIX?.trim() || CLAUDE_TOOL_PREFIX;
}

/** Estado do vinculo, relativo ao projeto quando nao vem um caminho absoluto. */
export const CLAUDE_STATE_DIR = '.claude/.state/pyatiletka';

/** Raiz do projeto. Sem a variavel do host, cai no diretorio de trabalho. */
export function claudeProjectDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string {
  return env.CLAUDE_PROJECT_DIR?.trim() || cwd;
}

/**
 * Onde o vinculo mora. `PYATILETKA_STATE_DIR` vence e aceita caminho absoluto.
 * Com o plugin instalado, `CLAUDE_PLUGIN_DATA` tira o estado de dentro do
 * clone. Sem nada disso, o padrao e `.claude/.state/pyatiletka`.
 */
export function claudeStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PYATILETKA_STATE_DIR?.trim();
  if (explicit) return explicit;
  const data = env.CLAUDE_PLUGIN_DATA?.trim();
  if (data) return join(data, 'state');
  return CLAUDE_STATE_DIR;
}

/** Sessao do Claude Code, ou `undefined` quando o host nao exporta a variavel. */
export function claudeSessionID(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.CLAUDE_CODE_SESSION_ID?.trim() || undefined;
}

/**
 * Nome do arquivo do vinculo. O servidor MCP e o hook leem a mesma variavel, entao
 * gravam e leem o mesmo arquivo. No servidor a variavel fica no valor do spawn
 * e nao muda com `/clear`. Sem a variavel, o vinculo volta a ser do projeto.
 */
export function claudeBindingKey(env: NodeJS.ProcessEnv = process.env): string {
  return claudeSessionID(env) ?? WORKSPACE_KEY;
}
