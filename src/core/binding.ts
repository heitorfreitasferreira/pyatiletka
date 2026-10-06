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
