import { spawnSync } from 'node:child_process';
import type { ProviderName } from './config';

/**
 * Resolucao do repo a partir do remote do clone. Funciona para qualquer
 * diretorio e revela o provider, o que dispensa `PYATILETKA_PROVIDER` na maioria
 * dos casos e nao depende do nome da pasta.
 */

export type Remote = { host: string; owner: string; repo: string };

export function parseRemote(url: string): Remote | undefined {
  const raw = url.trim();
  if (!raw) return undefined;

  // https://host/owner/repo(.git) e ssh://git@host(:port)/owner/repo(.git)
  const withScheme = raw.match(
    /^[a-z+.-]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
  );
  if (withScheme) {
    return { host: withScheme[1], owner: withScheme[2], repo: withScheme[3] };
  }

  // scp-like: git@host:owner/repo(.git)
  const scp = raw.match(/^(?:[^@/]+@)?([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (scp) {
    return { host: scp[1], owner: scp[2], repo: scp[3] };
  }

  return undefined;
}

export function detectProvider(host: string): ProviderName {
  const h = host.toLowerCase();
  return h === 'github.com' || h.endsWith('.github.com') || h.includes('github')
    ? 'github'
    : 'gitea';
}

export type ResolvedRepo = { provider: ProviderName; slug: string; host: string };

export function resolveRepoFromRemote(url: string | undefined): ResolvedRepo | undefined {
  const r = url ? parseRemote(url) : undefined;
  if (!r) return undefined;
  return { provider: detectProvider(r.host), slug: `${r.owner}/${r.repo}`, host: r.host };
}

/** Le `git remote get-url origin` no diretorio. Silencioso se nao for repo. */
export function resolveRepo(directory: string): ResolvedRepo | undefined {
  const out = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (out.status !== 0) return undefined;
  return resolveRepoFromRemote(out.stdout);
}
