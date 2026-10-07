import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderName } from '../config';

/**
 * Camada de CLI ja autenticada. O plugin nao guarda nada, usa o login que o
 * usuario ja fez com `gh` (GitHub) ou `tea` (Gitea). Toda chamada e silenciosa,
 * com timeout, sem prompt de terminal e com o token sempre mascarado no erro.
 */

export type RunResult = { status: number; stdout: string; stderr: string };
export type Runner = (cmd: string, args: string[], input?: string) => RunResult;

/** Executa uma CLI. `GIT_TERMINAL_PROMPT=0` evita travar pedindo credencial. */
export const defaultRunner: Runner = (cmd, args, input) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    input,
    timeout: 15_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' },
  });
  return {
    status: r.status ?? 127,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
  };
};

/** Token de um login ativo do `gh` para o host. */
export function ghToken(host: string, run: Runner = defaultRunner): string | undefined {
  const r = run('gh', ['auth', 'token', '--hostname', host]);
  if (r.status !== 0) return undefined;
  // Shim de versao (mise e afins) imprime aviso antes do token: vale a ultima
  // linha nao vazia, nao o stdout inteiro.
  const lines = r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) || undefined;
}

/** O `gh` tem login ativo para o host? */
export function ghLoggedIn(host: string, run: Runner = defaultRunner): boolean {
  return run('gh', ['auth', 'status', '--hostname', host]).status === 0;
}

/** O binario existe no PATH? Usado para dizer o que da para fazer em `auth_login`. */
export function hasBinary(cmd: string, run: Runner = defaultRunner): boolean {
  return run(cmd, ['--version']).status === 0;
}

type TeaLogin = { url: string; token?: string; isDefault: boolean };

/** Converte o YAML de logins do `tea` em registros. Parser de linhas, sem dep. */
export function parseTeaLogins(text: string): TeaLogin[] {
  const out: TeaLogin[] = [];
  let current: TeaLogin | undefined;

  const unquote = (v: string) => v.trim().replace(/^['"]|['"]$/g, '');

  for (const line of text.split(/\r?\n/)) {
    const start = /^\s*-\s+name:\s*(.*)$/.exec(line);
    if (start) {
      if (current) out.push(current);
      current = { url: '', isDefault: false };
      continue;
    }
    if (!current) continue;
    const url = /^\s*url:\s*(.*)$/.exec(line);
    if (url) current.url = unquote(url[1]);
    const token = /^\s*token:\s*(.*)$/.exec(line);
    if (token && token[1].trim()) current.token = unquote(token[1]);
    if (/^\s*default:\s*true\s*$/.test(line)) current.isDefault = true;
  }
  if (current) out.push(current);
  return out;
}

/** Caminhos conhecidos do config do `tea`, do novo (XDG) para o antigo. */
export function teaConfigPaths(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME || homedir();
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  return [join(configHome, 'tea', 'config.yml'), join(home, '.tea', 'tea.yml')];
}

/** Token de um login do `tea` cujo host casa. Prefere o login marcado default. */
export function teaTokenFromConfig(
  host: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const logins: TeaLogin[] = [];
  for (const path of teaConfigPaths(env)) {
    if (!existsSync(path)) continue;
    try {
      logins.push(...parseTeaLogins(readFileSync(path, 'utf8')));
    } catch {
      /* arquivo ilegivel: tenta o proximo */
    }
  }
  const matches = logins.filter((l) => l.token && sameHost(l.url, host));
  const chosen = matches.find((l) => l.isDefault) ?? matches[0];
  return chosen?.token;
}

/** Token do `tea`, primeiro pelo credential helper, depois pelo config. */
export function teaToken(
  host: string,
  run: Runner = defaultRunner,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const input = `protocol=https\nhost=${host}\n\n`;
  const r = run('tea', ['login', 'helper', 'get'], input);
  if (r.status === 0) {
    const line = r.stdout.split('\n').find((l) => l.startsWith('password='));
    const token = line?.slice('password='.length).trim();
    if (token) return token;
  }
  return teaTokenFromConfig(host, env);
}

/** O `tea` tem algum login configurado? */
export function teaLoggedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const path of teaConfigPaths(env)) {
    if (!existsSync(path)) continue;
    try {
      if (parseTeaLogins(readFileSync(path, 'utf8')).length) return true;
    } catch {
      /* arquivo ilegivel: tenta o proximo */
    }
  }
  return false;
}

function sameHost(url: string, host: string): boolean {
  try {
    const u = new URL(url);
    // `host` pode trazer a porta (Gitea em host:3000). Casa com ou sem ela.
    return (
      u.host.toLowerCase() === host.toLowerCase() || u.hostname.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return url.toLowerCase().includes(host.toLowerCase());
  }
}

/** Provider a partir das CLIs logadas. `undefined` quando nenhuma ou ambas. */
export function detectProviderFromCli(
  host: string | undefined,
  run: Runner = defaultRunner,
  env: NodeJS.ProcessEnv = process.env
): ProviderName | undefined {
  const gh = ghLoggedIn(host || 'github.com', run);
  const tea = teaLoggedIn(env);
  if (gh && !tea) return 'github';
  if (tea && !gh) return 'gitea';
  return undefined;
}
