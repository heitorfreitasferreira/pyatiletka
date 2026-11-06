import { tool } from '@opencode-ai/plugin';
import { toolSpecs, type ToolSpec } from './spec';
import { pickRepo, type Ctx } from '../core/context';

/**
 * Tools de repositorio: leitura de arquivos, lista de repos e gerenciamento
 * de variaveis/secrets de CI.
 */

export type RepoToolsInput = {
  ctx: Ctx;
};

const repoArg = (ctx: Ctx) =>
  tool.schema
    .string()
    .optional()
    .describe(
      ctx.defaultRepo
        ? `Slug do repo (default ${ctx.defaultRepo})`
        : 'Slug do repo no formato owner/nome'
    );

export function repoTools({ ctx }: RepoToolsInput): ToolSpec[] {
  const repoArgHere = repoArg(ctx);
  const resolve = (arg?: string) => pickRepo(ctx, arg);

  return toolSpecs({
    repo_file: tool({
      description:
        'Le um arquivo de um repo em uma ref (branch, tag, commit). Devolve o conteudo decodificado (base64 -> texto). Para diretorios, use a API do provedor diretamente.',
      args: {
        repo: repoArgHere,
        path: tool.schema
          .string()
          .describe('Caminho do arquivo no repo (ex.: .gitea/workflows/ci.yml).'),
        ref: tool.schema
          .string()
          .optional()
          .describe('Branch, tag ou commit. Default: branch padrao do repo.'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const file = await ctx.host.getRepoFile(repo, args.path, args.ref);
        if (file.encoding === 'base64') {
          try {
            const decoded = Buffer.from(file.content, 'base64').toString('utf-8');
            return [
              `${repo}:${args.path} @ ${args.ref ?? 'default'} (${file.size} bytes)`,
              '---',
              decoded,
            ].join('\n');
          } catch {
            return `${repo}:${args.path} - falha ao decodificar base64 (binario?). Tamanho: ${file.size} bytes.`;
          }
        }
        return [
          `${repo}:${args.path} @ ${args.ref ?? 'default'} (${file.size} bytes)`,
          '---',
          file.content,
        ].join('\n');
      },
    }),

    repo_list: tool({
      description: `Lista repos da org. Aceita glob para filtrar por nome (ex.: 'api-*'). Sem argumentos, lista todos da org configurada.`,
      args: {
        org: tool.schema
          .string()
          .optional()
          .describe('Org (default: PYATILETKA_ORG ou org do defaultRepo).'),
        filter: tool.schema.string().optional().describe('Glob para filtrar nomes (ex.: api-*).'),
      },
      async execute(args) {
        const org = args.org ?? ctx.config.org;
        if (!org)
          throw new Error(
            'Org nao definida. Informe `org` ou defina PYATILETKA_ORG / PYATILETKA_DEFAULT_REPO.'
          );
        const repos = await ctx.host.listRepos(org);
        const filtered = args.filter
          ? repos.filter((r) => {
              const short = r.split('/')[1] ?? r;
              const rx = new RegExp(
                `^${args
                  .filter!.split('*')
                  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                  .join('.*')}$`,
                'i'
              );
              return rx.test(short);
            })
          : repos;
        if (!filtered.length)
          return `Nenhum repo encontrado em ${org}${args.filter ? ` com filtro ${args.filter}` : ''}.`;
        return `${org}: ${filtered.length} repo(s)\n${filtered.join('\n')}`;
      },
    }),

    ci_config: tool({
      description:
        'Gerencia variaveis e secrets de CI do repo. `list` mostra o atual. `set_var` cria/atualiza variavel. `set_secret` cria/atualiza secret (valor nunca ecoado). `del_var` e `del_secret` removem.',
      args: {
        repo: repoArgHere,
        action: tool.schema
          .enum(['list', 'set_var', 'set_secret', 'del_var', 'del_secret'])
          .describe('Operacao.'),
        name: tool.schema
          .string()
          .optional()
          .describe('Nome da variavel/secret (obrigatorio exceto em list).'),
        value: tool.schema
          .string()
          .optional()
          .describe('Valor (obrigatorio em set_var e set_secret).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);

        const action = args.action ?? 'list';

        if (action === 'list') {
          const config = await ctx.host.getActionsConfig(repo);
          const vars = config.variables.length
            ? config.variables
                .map((v) => `  ${v.name}=${v.value ?? ''} (${v.lines} linhas, ${v.chars} chars)`)
                .join('\n')
            : '  (nenhuma)';
          const secrets = config.secrets.length
            ? config.secrets.map((s) => `  ${s}`).join('\n')
            : '  (nenhum)';
          return [
            `${repo} - CI config`,
            'variaveis:',
            vars,
            'secrets:',
            secrets,
            '',
            'workflows:',
            config.workflows.length
              ? config.workflows
                  .map((w) => `  ${w.name} (${w.path ?? '?'}) [${w.state ?? '?'}]`)
                  .join('\n')
              : '  (nenhum)',
          ].join('\n');
        }

        const needsName = ['set_var', 'set_secret', 'del_var', 'del_secret'].includes(action);
        if (needsName && !args.name) throw new Error('`name` obrigatorio para esta acao.');
        const name = args.name!;

        if (action === 'set_var') {
          if (!args.value) throw new Error('`value` obrigatorio para set_var.');
          const value = args.value!;
          await ctx.host.upsertActionsVariable(repo, name, value);
          return `Variavel ${name} criada/atualizada em ${repo}.`;
        }

        if (action === 'set_secret') {
          if (!args.value) throw new Error('`value` obrigatorio para set_secret.');
          const value = args.value!;
          await ctx.host.upsertActionsSecret(repo, name, value);
          return `Secret ${name} criado/atualizado em ${repo}. (valor nao exibido)`;
        }

        if (action === 'del_var') {
          await ctx.host.deleteActionsVariable(repo, name);
          return `Variavel ${name} removida de ${repo}.`;
        }

        if (action === 'del_secret') {
          await ctx.host.deleteActionsSecret(repo, name);
          return `Secret ${name} removido de ${repo}.`;
        }

        throw new Error(`Acao desconhecida: ${action}`);
      },
    }),
  });
}
