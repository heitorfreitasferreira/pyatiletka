import {
  ConfigError,
  loadConfig,
  optionsToEnv,
  resolveProvider,
  type Config,
  type ProviderName,
} from '../config';
import {
  defaultRunner,
  detectProviderFromCli,
  loadDotenv,
  missingCredentialMessage,
  readAuthMode,
  resolveAuth,
  type Runner,
} from '../auth';
import { createGitHost } from '../providers';
import type { GitHost } from '../providers/types';
import { localDefaultBranch, resolveRepo } from '../repo';
import { readBinding, type Binding } from './binding';

/**
 * O que as quatro tools repetem: descobrir o provider, resolver o repo,
 * avisar o usuario e abrir o vinculo da sessao. Fica aqui para o `repoFromPath`
 * que existia em cada arquivo nao virar quatro copias, e para a resolucao do
 * repo ser a mesma em todas.
 */

export type NotifyVariant = 'info' | 'success' | 'error' | 'warning';

export type Client = {
  tui?: { showToast?: (input: unknown) => Promise<unknown> | unknown };
};

export type Ctx = {
  host: GitHost;
  config: Config;
  /** Repo do clone, quando `directory` esta dentro de um. */
  remote?: string;
  /** SlugPadrao: `PYATILETKA_DEFAULT_REPO`, o remote do clone, ou o que a tool recebeu. */
  defaultRepo?: string;
  /** Runner das CLIs de credencial. Injetavel para teste. */
  run?: Runner;
  notify(message: string, variant?: NotifyVariant): void;
};

/** Aceita `repo`, `owner/repo` ou `repo` (prefixado com a org) e devolve `owner/repo`. */
export function normRepo(value: string, org?: string): string {
  const v = value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '');
  if (v.includes('/')) return v;
  if (!org)
    throw new Error(`repo "${value}" sem org. Informe owner/repo ou defina PYATILETKA_ORG.`);
  return `${org}/${v}`;
}

/** Numero de issue/PR/run, aceitando `#77`. `NaN` quando nao e numero. */
export function parseRef(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  // `Number('')` e 0, que passaria em `Number.isFinite` e viraria issue 0.
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (!raw) return NaN;
  return Number(raw);
}

/** Numero de um array de refs, ignorando o que nao for numero. */
export function parseRefs(values?: string[]): number[] {
  return (values ?? []).map(parseRef).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Host que so falha quando usado, com a mensagem de credencial. Assim a carga
 * do plugin nunca derruba a sessao por falta de token, e a primeira chamada de
 * rede diz exatamente o que fazer.
 */
function unavailableHost(config: Config): GitHost {
  const message = missingCredentialMessage(config);
  return new Proxy({} as GitHost, {
    get(_target, prop) {
      if (prop === 'provider') return config.provider;
      if (prop === 'then') return undefined;
      // `async` para rejeitar em vez de lancar sincrono. Quem chama usa
      // `.catch()` para degradar, e um lancamento sincrono escaparia da guarda.
      return async () => {
        throw new ConfigError(message);
      };
    },
  });
}

/**
 * Monta o contexto da tool. Ordem da credencial: ambiente e `.env` primeiro,
 * depois `gh`/`tea`. O provider vem de `PYATILETKA_PROVIDER`, do remote do
 * clone, ou da CLI que estiver logada. Sem provider ou sem token a carga nao
 * falha: o host vira um que explica o que falta na primeira chamada e as tools
 * de credencial continuam disponiveis.
 */
export function createCtx(input: {
  directory: string;
  client?: Client;
  env?: NodeJS.ProcessEnv;
  /** Opcoes do plugin no v2 (`ctx.options`). Sobrepõem o ambiente. */
  options?: Record<string, unknown>;
  run?: Runner;
}): Ctx {
  const env = input.env ?? process.env;
  const run = input.run ?? defaultRunner;
  const dotenv = loadDotenv(input.directory, env);
  // Roteamento (URL, provider, host) so vem do ambiente real e dos `.env`
  // confiaveis. O `.env` do projeto, que o clone controla, so fornece token.
  // As options do `opencode.json` entram junto: sao confiaveis e nao trazem
  // token nem URL.
  const configEnv = { ...dotenv.trusted, ...optionsToEnv(input.options), ...env };
  const remote = resolveRepo(input.directory);

  const mode = readAuthMode(configEnv);
  const explicit = resolveProvider(configEnv, remote?.provider);
  const provider: ProviderName | undefined =
    explicit ?? (mode === 'env' ? undefined : detectProviderFromCli(remote?.host, run, configEnv));

  const config = loadConfig(configEnv, provider, input.options, remote?.host);

  // Derivacao local, sem rede: o clone revela repo, org e branch padrao. O
  // valor explicito do ambiente, quando existe, vence.
  if (remote) {
    config.defaultRepo ??= remote.slug;
    config.org ??= remote.slug.split('/')[0];
  }
  config.defaultBranch ??= localDefaultBranch(input.directory);

  if (config.provider) {
    const auth = resolveAuth({
      provider: config.provider,
      host: config.host,
      env,
      fileEnv: dotenv.all,
      run,
      mode,
    });
    config.token = auth.token;
    config.authSource = auth.source;
  }

  const host = config.provider && config.token ? createGitHost(config) : unavailableHost(config);

  const notify = (message: string, variant: NotifyVariant = 'info') => {
    void input.client?.tui?.showToast?.({ body: { message, variant } });
  };

  return {
    host,
    config,
    remote: remote?.slug,
    defaultRepo: config.defaultRepo ?? remote?.slug,
    run,
    notify,
  };
}

/**
 * Repo de uma tool: o que o argumento pede, depois o vinculo da sessao, depois
 * o padrao do ambiente ou do clone. Ordem pensada para o caso comum, que e o
 * agente trabalhando na issue vinculada e nao passando repo a cada chamada.
 */
export function pickRepo(ctx: Ctx, arg?: string, binding?: Binding): string {
  const wanted = arg ?? binding?.repo ?? ctx.defaultRepo;
  if (!wanted) {
    throw new Error(
      'Nao deu para saber o repo. Informe `repo` (owner/nome), defina PYATILETKA_DEFAULT_REPO, ' +
        'ou rode dentro de um clone com remote.'
    );
  }
  return normRepo(wanted, ctx.config.org);
}

/** Vinculo da sessao, lido do disco. */
export function bindingOf(directory: string, sessionID: string): Binding | undefined {
  return readBinding(directory, sessionID);
}

/** Globs simples sobre uma lista. `api-*` casa `api-core` e `api-web`. */
export function matchGlob(value: string, pattern: string): boolean {
  const rx = new RegExp(
    `^${pattern
      .split('*')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i'
  );
  return rx.test(value);
}

/**
 * Expande a lista pedida em slugs `owner/nome`. Um item sem barra casa com o
 * glob contra o nome do repo dentro da org. Sem lista e sem `repos` explicito,
 * varre a org inteira, que e o que `ci_runs` e `pr_list` fazem sem repo.
 */
export async function expandRepos(ctx: Ctx, wanted?: string[]): Promise<string[]> {
  const org = ctx.config.org;
  const all = org ? await ctx.host.listRepos(org) : [];

  if (!wanted?.length) {
    if (!org)
      throw new Error('Varredura de org precisa de PYATILETKA_ORG ou PYATILETKA_DEFAULT_REPO.');
    return all;
  }

  const out: string[] = [];
  for (const item of wanted) {
    const v = item.trim();
    if (!v) continue;
    if (!v.includes('/') && !v.includes('*')) {
      out.push(normRepo(v, org));
      continue;
    }
    if (v.includes('/')) {
      out.push(v);
      continue;
    }
    // Glob dentro da org: casa pelo nome curto do repo.
    for (const repo of all) {
      const short = repo.split('/')[1] ?? repo;
      if (matchGlob(short, v) && !out.includes(repo)) out.push(repo);
    }
  }
  return out;
}

export type { Config, ProviderName };
