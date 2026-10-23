import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Vinculo entre a sessao do agente e uma issue.
 *
 * Vive em arquivo, e nao em memoria, porque a sessao pode ser retomada em
 * outro processo e a compactacao recria o contexto. O caminho segue o que o
 * opencode ja usa para estado local do workspace, entao o arquivo e ignorado
 * pelo git junto com o resto de `.opencode/.state`. Cada host passa o proprio
 * `stateDir`: o Claude Code usa `.claude/.state/pyatiletka`.
 */

export const STATE_DIR = '.opencode/.state/issue-sessions';

/**
 * Nome do arquivo do vinculo de workspace, usado quando o host nao tem um
 * identificador de sessao (servidor MCP). Um vinculo por diretorio do projeto.
 */
export const WORKSPACE_KEY = 'workspace';

export type Binding = {
  repo: string;
  issue?: number;
  milestone?: string;
  boundAt: string;
};

/**
 * Pasta do projeto dentro de um `stateDir` absoluto: o caminho do projeto com
 * todo caractere fora de `[A-Za-z0-9]` trocado por `-`, como o Claude Code faz
 * em `~/.claude/projects`.
 */
export function projectKey(directory: string): string {
  return resolve(directory).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * `stateDir` relativo fica dentro do projeto. `stateDir` absoluto (o
 * `CLAUDE_PLUGIN_DATA` do plugin, comum a todos os projetos) ganha uma pasta por
 * projeto, senao dois projetos abertos ao mesmo tempo dividiriam um vinculo.
 */
export function bindingFile(directory: string, sessionID: string, stateDir = STATE_DIR): string {
  if (!isAbsolute(stateDir)) return resolve(directory, stateDir, `${sessionID}.json`);
  return join(stateDir, projectKey(directory), `${sessionID}.json`);
}

/** Vinculo da sessao. `undefined` quando nao ha, e tambem quando o JSON esta ruim. */
export function readBinding(
  directory: string,
  sessionID: string,
  stateDir?: string
): Binding | undefined {
  const f = bindingFile(directory, sessionID, stateDir);
  if (!existsSync(f)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as Binding;
    return typeof parsed?.repo === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Grava o vinculo e devolve o caminho, que as tools mostram na saida. */
export function writeBinding(
  directory: string,
  sessionID: string,
  b: Binding,
  stateDir?: string
): string {
  const f = bindingFile(directory, sessionID, stateDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(b, null, 2)}\n`);
  return f;
}

export function clearBinding(directory: string, sessionID: string, stateDir?: string): boolean {
  const f = bindingFile(directory, sessionID, stateDir);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}

/**
 * Onde o vinculo da sessao mora. O v1 usa arquivo (default, abaixo), o v2 usa
 * `ctx.storage`. As tools falam so com esta interface.
 */
export type BindingStore = {
  read(sessionID: string): Binding | undefined | Promise<Binding | undefined>;
  /** Devolve o caminho quando existe um (store de arquivo), senao undefined. */
  write(sessionID: string, b: Binding): string | undefined | Promise<string | undefined>;
  clear(sessionID: string): boolean | undefined | Promise<boolean | undefined>;
};

export function fileBinding(directory: string, stateDir?: string): BindingStore {
  return {
    read: (sessionID) => readBinding(directory, sessionID, stateDir),
    write: (sessionID, b) => writeBinding(directory, sessionID, b, stateDir),
    clear: (sessionID) => clearBinding(directory, sessionID, stateDir),
  };
}

/**
 * Store sem sessao: um vinculo por diretorio do projeto. O servidor MCP nao
 * recebe identificador de sessao em cada chamada, entao o vinculo e do
 * workspace. So a ultima escrita vale, e `issue_unbind` limpa para todos.
 */
export function workspaceBinding(directory: string, stateDir?: string): BindingStore {
  return {
    read: () => readBinding(directory, WORKSPACE_KEY, stateDir),
    write: (_sessionID, b) => writeBinding(directory, WORKSPACE_KEY, b, stateDir),
    clear: () => clearBinding(directory, WORKSPACE_KEY, stateDir),
  };
}

/** Store minimo de JSON, para nao acoplar o core ao tipo do plugin. */
export type JsonStorage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

export function storageBinding(storage: JsonStorage): BindingStore {
  const key = (sessionID: string) => `binding/${sessionID}`;
  return {
    read: async (sessionID) => {
      const v = await storage.get(key(sessionID));
      return isBinding(v) ? v : undefined;
    },
    write: async (sessionID, b) => {
      await storage.set(key(sessionID), b);
      return undefined;
    },
    clear: async (sessionID) => {
      await storage.remove(key(sessionID));
      return true;
    },
  };
}

function isBinding(v: unknown): v is Binding {
  return typeof (v as Binding | null)?.repo === 'string';
}
