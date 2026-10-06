import type { ProseMode } from './prose';

/**
 * Configuracao por ambiente. Sem arquivo, sem tea, sem estado no disco:
 * o usuario aponta `GITEA_URL`/`GITEA_TOKEN` ou `GITHUB_TOKEN` e o plugin
 * resolve o resto.
 */

export type ProviderName = 'gitea' | 'github';

export type Config = {
  provider: ProviderName;
  /** Base da API, sem barra final. Gitea: GITEA_URL. GitHub: GITHUB_API_URL. */
  baseUrl: string;
  token: string;
  /** Org usada quando o slug do repo nao vem do remote. */
  org?: string;
  /** Repo padrao `owner/nome`, para tools chamadas fora de um clone. */
  defaultRepo?: string;
  /** Login do filtro `mine`. */
  login?: string;
  /** Branch usada quando o pedido nao informa. Vazio = o agente precisa dizer. */
  defaultBranch?: string;
  /**
   * Ordem de promocao de `branch_promote`. Cada branch so sobe para as que
   * vem depois dela nesta lista.
   */
  promoteOrder: string[];
  prose: ProseMode;
};

export class ConfigError extends Error {}

const normUrl = (v: string) => v.trim().replace(/\/+$/, '');

/** Ordem de promocao padrao: `staging` sobe para `production`. */
export const DEFAULT_PROMOTE_ORDER = ['staging', 'production'];

function readPromoteOrder(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PYATILETKA_PROMOTE_ORDER?.trim();
  if (!raw) return DEFAULT_PROMOTE_ORDER;
  const order = raw
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  if (order.length < 2) {
    throw new ConfigError(
      `PYATILETKA_PROMOTE_ORDER invalido: "${env.PYATILETKA_PROMOTE_ORDER}". Use duas ou mais branches separadas por virgula.`
    );
  }
  return order;
}

function readProse(env: NodeJS.ProcessEnv): ProseMode {
  const v = (env.PYATILETKA_PROSE ?? 'block').trim().toLowerCase();
  if (v === 'off' || v === 'warn' || v === 'block') return v;
  throw new ConfigError(
    `PYATILETKA_PROSE invalido: "${env.PYATILETKA_PROSE}". Use off, warn ou block.`
  );
}

/**
 * Provider: `PYATILETKA_PROVIDER` manda. Sem ele, o remote do clone decide, e por
 * ultimo o ambiente (GITEA_URL presente, senao GITHUB_TOKEN).
 */
export function resolveProvider(
  env: NodeJS.ProcessEnv,
  remoteProvider?: ProviderName
): ProviderName | undefined {
  const explicit = env.PYATILETKA_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    if (explicit === 'gitea' || explicit === 'github') return explicit;
    throw new ConfigError(
      `PYATILETKA_PROVIDER invalido: "${env.PYATILETKA_PROVIDER}". Use gitea ou github.`
    );
  }
  if (remoteProvider) return remoteProvider;
  if (env.GITEA_URL) return 'gitea';
  if (env.GITHUB_TOKEN) return 'github';
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv, remoteProvider?: ProviderName): Config {
  const provider = resolveProvider(env, remoteProvider);
  if (!provider) {
    throw new ConfigError(
      'Nenhum provider configurado. Defina GITEA_URL/GITEA_TOKEN (Gitea) ou GITHUB_TOKEN (GitHub), ' +
        'ou rode dentro de um clone com remote no GitHub/Gitea.'
    );
  }

  const defaultRepo = env.PYATILETKA_DEFAULT_REPO?.trim() || undefined;
  const org = env.PYATILETKA_ORG?.trim() || defaultRepo?.split('/')[0] || undefined;
  const defaultBranch = env.PYATILETKA_DEFAULT_BRANCH?.trim() || undefined;
  const promoteOrder = readPromoteOrder(env);

  if (provider === 'gitea') {
    const baseUrl = normUrl(env.GITEA_URL ?? '');
    if (!baseUrl)
      throw new ConfigError('GITEA_URL ausente. Ex.: GITEA_URL=https://gitea.example.com');
    const token = env.GITEA_TOKEN?.trim();
    if (!token) throw new ConfigError('GITEA_TOKEN ausente.');
    return {
      provider,
      baseUrl,
      token,
      org,
      defaultRepo,
      login: env.PYATILETKA_LOGIN?.trim() || undefined,
      defaultBranch,
      promoteOrder,
      prose: readProse(env),
    };
  }

  const baseUrl = normUrl(env.GITHUB_API_URL ?? 'https://api.github.com');
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) throw new ConfigError('GITHUB_TOKEN ausente.');
  return {
    provider,
    baseUrl,
    token,
    org,
    defaultRepo,
    login: env.PYATILETKA_LOGIN?.trim() || undefined,
    defaultBranch,
    promoteOrder,
    prose: readProse(env),
  };
}
