import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Leitor de `.env` minimo, sem dependencia nova. O ambiente real sempre vence
 * o arquivo, igual aos carregadores de segredo do ecossistema do opencode.
 *
 * Ordem de leitura, do menos para o mais especifico, entao o ultimo vence:
 * `~/.config/pyatiletka/env`, `~/.config/opencode/.env`, `./.env` do projeto e,
 * por fim, o caminho de `PYATILETKA_ENV_FILE`.
 */

const KEY = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** Interpreta o valor de uma linha: aspas, escapes de `\n` e comentario no fim. */
export function parseDotenvValue(raw: string): string {
  const value = raw.trim();
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    const inner = end === -1 ? value.slice(1) : value.slice(1, end);
    // Aspas duplas aceitam escape, simples e literal.
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : inner;
  }

  const hash = value.indexOf(' #');
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

/** Converte o texto de um `.env` em pares. Linhas em branco e comentarios saem. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = KEY.exec(trimmed);
    if (!m) continue;
    out[m[1]] = parseDotenvValue(m[2]);
  }
  return out;
}

/** Locais lidos, do menos para o mais especifico. `PYATILETKA_ENV_FILE` fecha a lista. */
export function dotenvPaths(directory: string, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME || homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  const paths = [
    join(configHome, 'pyatiletka', 'env'),
    join(configHome, 'opencode', '.env'),
    join(directory, '.env'),
  ];
  if (env.PYATILETKA_ENV_FILE) paths.push(env.PYATILETKA_ENV_FILE);
  return paths;
}

/**
 * O resultado da leitura, separado por confianca. O `.env` do projeto vive
 * dentro do clone e o repo o controla, entao ele so pode fornecer token. URL,
 * provider e host saem dos arquivos em `$HOME`, de `PYATILETKA_ENV_FILE` e do
 * ambiente real, que o repositorio nao alcanca.
 */
export type DotenvLayers = {
  /** Arquivos confiaveis: `$HOME` e `PYATILETKA_ENV_FILE`. */
  trusted: Record<string, string>;
  /** Chaves do `.env` do projeto, dentro do clone. */
  project: Record<string, string>;
  /** Visao ordenada para o token, do menos para o mais especifico. */
  all: Record<string, string>;
};

/**
 * Le os `.env` existentes. Um arquivo que falha nao derruba a carga. `all` segue
 * a ordem do caminho, o ultimo vence. `trusted` e `project` separam a origem
 * para que o roteamento ignore o que veio do clone.
 */
export function loadDotenv(directory: string, env: NodeJS.ProcessEnv): DotenvLayers {
  const projectPath = join(directory, '.env');
  const trusted: Record<string, string> = {};
  const project: Record<string, string> = {};
  const all: Record<string, string> = {};

  for (const path of dotenvPaths(directory, env)) {
    if (!path || !existsSync(path)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseDotenv(readFileSync(path, 'utf8'));
    } catch {
      /* arquivo ilegivel: segue com o que ja tem */
      continue;
    }
    Object.assign(all, parsed);
    Object.assign(path === projectPath ? project : trusted, parsed);
  }
  return { trusted, project, all };
}
