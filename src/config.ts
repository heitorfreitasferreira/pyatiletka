import type { ProseMode } from './prose';

/**
 * Configuracao por ambiente. O token pode vir do ambiente, de um `.env`, de uma
 * CLI ja logada (`gh`, `tea`) ou de um login manual, resolvido em `resolveAuth`.
 * Aqui fica so o que nao e segredo e a base para a resolucao da credencial.
 */

export type ProviderName = 'gitea' | 'github';

/** De onde veio o token. `none` significa que nada respondeu ainda. */
export type AuthSource = 'env' | 'dotenv' | 'gh' | 'tea' | 'none';

export type Config = {
  /** `undefined` quando nem o ambiente, nem o remote, nem uma CLI definem. */
  provider: ProviderName | undefined;
  /** Base da API, sem barra final. Gitea: GITEA_URL. GitHub: GITHUB_API_URL. */
  baseUrl: string;
  /** Host git, usado para achar a credencial no `gh`/`tea`. */
  host: string;
  token: string;
  /** Origem do token, para `auth_status`. */
  authSource?: AuthSource;
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
  if (env.GITHUB_TOKEN || env.GH_TOKEN) return 'github';
  return undefined;
}

/**
 * Opcoes do `plugins` do opencode.json, no formato das variaveis de ambiente
 * que o resto do config ja le. Options sobrepoem o ambiente. Nao carregam
 * token nem URL, entao nao abrem o desvio que o `.env` do projeto abriria.
 */
export function optionsToEnv(options?: Record<string, unknown>): NodeJS.ProcessEnv {
  if (!options) return {};
  const out: NodeJS.ProcessEnv = {};
  const str = (key: string, env: string) => {
    const v = options[key];
    if (typeof v === 'string' && v.trim()) out[env] = v;
  };
  const arr = (key: string, env: string) => {
    const v = options[key];
    if (Array.isArray(v) && v.length) out[env] = v.map(String).join(',');
  };
  str('provider', 'PYATILETKA_PROVIDER');
  str('org', 'PYATILETKA_ORG');
  str('defaultRepo', 'PYATILETKA_DEFAULT_REPO');
  str('defaultBranch', 'PYATILETKA_DEFAULT_BRANCH');
  str('login', 'PYATILETKA_LOGIN');
  str('prose', 'PYATILETKA_PROSE');
  arr('promoteOrder', 'PYATILETKA_PROMOTE_ORDER');
  return out;
}

/** Host de uma URL, sem esquema. `withPort` inclui a porta, que o `tea` precisa. */
function hostOf(url: string | undefined, withPort = false): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return withPort ? u.host : u.hostname;
  } catch {
    return undefined;
  }
}

/**
 * Host que o `gh` entende. `GITHUB_API_URL` costuma ser `api.github.com`, que
 * nao serve para `gh --hostname`. Tira o prefixo `api.` para voltar ao host git.
 */
function ghHost(env: NodeJS.ProcessEnv, remoteHost?: string): string {
  const fromApi = hostOf(env.GITHUB_API_URL);
  return remoteHost ?? (fromApi ? fromApi.replace(/^api\./, '') : 'github.com');
}

/**
 * Configuracao de ambiente. Sem provider e um estado valido: as tools de
 * credencial continuam carregando e explicando o que falta. O token tambem pode
 * estar vazio: quem resolve de verdade, inclusive `gh`/`tea` e `.env`, e o
 * `resolveAuth` chamado em `createCtx`.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  remoteProvider?: ProviderName,
  options?: Record<string, unknown>,
  remoteHost?: string
): Config {
  env = { ...env, ...optionsToEnv(options) };
  const provider = resolveProvider(env, remoteProvider);
  const defaultRepo = env.PYATILETKA_DEFAULT_REPO?.trim() || undefined;
  const org = env.PYATILETKA_ORG?.trim() || defaultRepo?.split('/')[0] || undefined;
  const defaultBranch = env.PYATILETKA_DEFAULT_BRANCH?.trim() || undefined;
  const login = env.PYATILETKA_LOGIN?.trim() || undefined;
  const promoteOrder = readPromoteOrder(env);
  const prose = readProse(env);

  if (provider === 'gitea') {
    const rawUrl = env.GITEA_URL?.trim();
    const baseUrl = rawUrl ? normUrl(rawUrl) : remoteHost ? `https://${remoteHost}` : '';
    if (!baseUrl) {
      throw new ConfigError(
        'GITEA_URL ausente e nao deu para deduzir a base do remote. Ex.: GITEA_URL=https://gitea.example.com'
      );
    }
    return {
      provider,
      baseUrl,
      host: hostOf(baseUrl, true) ?? remoteHost ?? '',
      token: env.GITEA_TOKEN?.trim() ?? '',
      org,
      defaultRepo,
      login,
      defaultBranch,
      promoteOrder,
      prose,
    };
  }

  if (provider === 'github') {
    const baseUrl = normUrl(env.GITHUB_API_URL ?? 'https://api.github.com');
    return {
      provider,
      baseUrl,
      host: ghHost(env, remoteHost),
      token: env.GITHUB_TOKEN?.trim() ?? env.GH_TOKEN?.trim() ?? '',
      org,
      defaultRepo,
      login,
      defaultBranch,
      promoteOrder,
      prose,
    };
  }

  // Sem provider nao ha rede a fazer. O host do remote, quando existe, ainda
  // ajuda o `auth_login` a apontar o lugar certo. `authStatus` diria `none`.
  return {
    provider: undefined,
    baseUrl: '',
    host: remoteHost ?? '',
    token: '',
    authSource: 'none',
    org,
    defaultRepo,
    login,
    defaultBranch,
    promoteOrder,
    prose,
  };
}
