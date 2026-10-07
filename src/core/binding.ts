import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Vinculo entre a sessao do opencode e uma issue.
 *
 * Vive em arquivo, e nao em memoria, porque a sessao pode ser retomada em
 * outro processo e a compactacao recria o contexto. O caminho segue o que o
 * opencode ja usa para estado local do workspace, entao o arquivo e ignorado
 * pelo git junto com o resto de `.opencode/.state`.
 */

const STATE_DIR = '.opencode/.state/issue-sessions';

export type Binding = {
  repo: string;
  issue?: number;
  milestone?: string;
  boundAt: string;
};

export function bindingFile(directory: string, sessionID: string): string {
  return join(directory, STATE_DIR, `${sessionID}.json`);
}

/** Vinculo da sessao. `undefined` quando nao ha, e tambem quando o JSON esta ruim. */
export function readBinding(directory: string, sessionID: string): Binding | undefined {
  const f = bindingFile(directory, sessionID);
  if (!existsSync(f)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as Binding;
    return typeof parsed?.repo === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Grava o vinculo e devolve o caminho, que as tools mostram na saida. */
export function writeBinding(directory: string, sessionID: string, b: Binding): string {
  const f = bindingFile(directory, sessionID);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(b, null, 2)}\n`);
  return f;
}

export function clearBinding(directory: string, sessionID: string): boolean {
  const f = bindingFile(directory, sessionID);
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

export function fileBinding(directory: string): BindingStore {
  return {
    read: (sessionID) => readBinding(directory, sessionID),
    write: (sessionID, b) => writeBinding(directory, sessionID, b),
    clear: (sessionID) => clearBinding(directory, sessionID),
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
