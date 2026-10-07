import { loadConfig, type Config, type ProviderName } from '../config';
import { createGitHost } from '../providers';
import type { GitHost } from '../providers/types';
import { resolveRepo } from '../repo';
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
 * Monta o contexto da tool. O provider vem do remote do clone quando existe,
 * senao do ambiente. Falha de config so na tools que realmente precisam dele:
 * quem so le binding ou template nao deve falhar por isso.
 */
export function createCtx(input: {
  directory: string;
  client: Client;
  env?: NodeJS.ProcessEnv;
}): Ctx {
  const env = input.env ?? process.env;
  const remote = resolveRepo(input.directory);
  const config = loadConfig(env, remote?.provider);
  const host = createGitHost(config);

  const notify = (message: string, variant: NotifyVariant = 'info') => {
    void input.client?.tui?.showToast?.({ body: { message, variant } });
  };

  return {
    host,
    config,
    remote: remote?.slug,
    defaultRepo: config.defaultRepo ?? remote?.slug,
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
