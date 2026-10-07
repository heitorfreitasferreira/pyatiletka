import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { assertProse } from '../prose';
import { expandRepos, parseRef, pickRepo, type Ctx } from '../core/context';
import { fmtComment, fmtReview, fmtReviewComment } from '../core/format';
import type { Checks, Pull, MergeStyle } from '../providers/types';

/**
 * Tools de pull request. `pr_merge` tem porta de CI verde e recusa por padrao:
 * a decisao e da tool, nao do provider, porque o provider so faz a chamada.
 */

export type PullToolsInput = {
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

const prArg = tool.schema.string().describe('Numero do PR');

const GREEN = new Set(['success']);

/**
 * Estado de CI do head. Sem check nenhum, o PR e liberado: `ok` e verdadeiro
 * porque nao ha o que esperar.
 */
export function statusOf(checks?: Checks) {
  const statuses = checks?.statuses ?? [];
  const failed = statuses.filter((s) => s.status === 'failure' || s.status === 'error');
  const pending = statuses.filter((s) => s.status === 'pending');
  const overall = checks?.overall ?? 'unknown';
  return {
    overall,
    total: statuses.length,
    failed,
    pending,
    ok: !statuses.length || GREEN.has(overall),
  };
}

export function fmtPR(pr: Pull, checks?: Checks): string {
  const { overall, ok } = statusOf(checks);
  const flags = [
    pr.draft ? 'draft' : '',
    pr.merged ? 'merged' : '',
    pr.mergeable === false ? 'conflito' : '',
  ].filter(Boolean);
  return [
    `#${String(pr.number).padEnd(5)} [${pr.state}${flags.length ? `/${flags.join('/')}` : ''}]`.padEnd(
      34
    ),
    `CI:${(overall + (ok ? '' : ' x')).padEnd(12)}`,
    `${(pr.baseRef ?? '?').padEnd(10)} <- ${(pr.headRef ?? '?').padEnd(28)}`,
    pr.title.slice(0, 70),
  ].join(' ');
}

/** Filtra o diff por caminho, mantendo o cabecalho e o corpo dos que casam. */
export function filterDiffByPath(diff: string, path: string): string {
  const rx = compile(path, 'path');
  return diff
    .split(/(?=^diff --git )/m)
    .filter((chunk) => !chunk.startsWith('diff --git ') || rx.test(chunk.slice(0, 300)))
    .join('');
}

export function filterDiffByGrep(diff: string, grep: string): string {
  const rx = compile(grep, 'grep');
  return diff
    .split('\n')
    .filter((l) => rx.test(l))
    .join('\n');
}

export function tailLines(text: string, tail: number): string {
  const lines = text.split('\n');
  if (lines.length <= tail) return text;
  return `(${lines.length} linhas no total, ultimas ${tail})\n${lines.slice(-tail).join('\n')}`;
}

function compile(pattern: string, field: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    throw new Error(`regex invalida em ${field}: ${pattern}`);
  }
}

export function pullTools({ ctx }: PullToolsInput): Record<string, ToolDefinition> {
  const repoArgHere = repoArg(ctx);
  const resolve = (arg?: string) => pickRepo(ctx, arg);

  const pull = async (repo: string, ref: string | number): Promise<Pull> => {
    const n = parseRef(ref);
    if (!Number.isFinite(n)) throw new Error(`PR invalido: ${ref}`);
    return ctx.host.getPull(repo, n);
  };

  const checksOf = (repo: string, pr: Pull) =>
    ctx.host.getChecks(repo, pr.headSha ?? '').catch(() => undefined);

  return {
    pr_list: tool({
      description:
        'Lista PRs de um repo com o estado de CI de cada um, montado a partir do status do head SHA (nao precisa de uma chamada por PR). Sem `repo`, varre a org inteira.',
      args: {
        repo: repoArgHere,
        repos: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Slugs para visao multi-repo; aceita glob. Ignorado se `repo` vier.'),
        state: tool.schema.enum(['open', 'closed', 'all']).optional().describe('Default open.'),
        base: tool.schema.string().optional().describe('Filtra por branch de destino.'),
        head: tool.schema.string().optional().describe('Filtra pela branch de origem.'),
        mine: tool.schema
          .boolean()
          .optional()
          .describe('So PRs abertos por mim. Depende de PYATILETKA_LOGIN.'),
        limit: tool.schema.number().optional().describe('Max PRs por repo (default 20).'),
      },
      async execute(args) {
        const state = args.state ?? 'open';
        const limit = args.limit ?? 20;
        const login = ctx.config.login?.toLowerCase();

        const one = async (repo: string) => {
          let list = await ctx.host.listPulls(repo, {
            state,
            base: args.base,
            head: args.head,
            limit: Math.max(limit, 50),
          });
          if (args.mine) {
            if (!login) throw new Error('`mine` precisa de PYATILETKA_LOGIN com o seu login.');
            list = list.filter((p) => p.user?.toLowerCase() === login);
          }
          return { repo, list: list.slice(0, limit) };
        };

        const single = args.repo ?? (args.repos?.length ? undefined : ctx.defaultRepo);
        if (single) {
          const repo = resolve(single);
          const { list } = await one(repo);
          if (!list.length) return `Nenhum PR ${state} em ${repo}.`;
          const out: string[] = [];
          for (const p of list) out.push(fmtPR(p, await checksOf(repo, p)));
          return [`${repo} - PRs ${state}`, `CI: estado do head sha`, '', ...out].join('\n');
        }

        const repos = await expandRepos(ctx, args.repos);
        const blocks: string[] = [];
        let total = 0;
        for (const repo of repos) {
          const { list } = await one(repo).catch(() => ({ repo, list: [] as Pull[] }));
          if (!list.length) continue;
          total += list.length;
          const lines: string[] = [];
          for (const p of list.slice(0, 5)) lines.push(fmtPR(p, await checksOf(repo, p)));
          if (list.length > 5) lines.push(`  ... +${list.length - 5} mais`);
          blocks.push(`${repo} ${'-'.repeat(Math.max(0, 44 - repo.length))}\n${lines.join('\n')}`);
        }
        if (!blocks.length) return `Nenhum PR ${state} nos repos indicados.`;
        return [`${total} PR(s) ${state}`, '', blocks.join('\n\n')].join('\n');
      },
    }),

    pr_view: tool({
      description:
        'Detalhe de um PR: branch, sha, mergeavel, corpo, CI do head e TODOS os comentarios (conversa, reviews e inline): eles sao contexto obrigatorio, igual na issue.',
      args: {
        pr: prArg,
        repo: repoArgHere,
        comments: tool.schema
          .number()
          .optional()
          .describe(
            'Quantos comentarios de conversa trazer, dos mais recentes. Default: todos. Use 0 para pular.'
          ),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const pr = await pull(repo, args.pr);
        const checks = await checksOf(repo, pr);
        const { overall, ok, failed, pending } = statusOf(checks);

        const lines = [
          `${repo}#${pr.number} - ${pr.title}`,
          `  url:       ${pr.htmlUrl ?? ''}`,
          `  estado:    ${pr.state}${pr.merged ? ' (merged)' : ''}${pr.draft ? ' (draft)' : ''}`,
          `  branches:  ${pr.headRef ?? '?'} -> ${pr.baseRef ?? '?'}`,
          `  head sha:  ${pr.headSha ?? '?'}`,
          `  autor:     ${pr.user ?? '?'}`,
          `  mergeavel: ${pr.mergeable === false ? 'NAO (conflito)' : 'sim'}`,
          `  criado:    ${pr.createdAt ?? '?'}   atualizado: ${pr.updatedAt ?? '?'}`,
          pr.labels.length ? `  labels:    ${pr.labels.join(', ')}` : '',
          pr.milestone ? `  marco:     ${pr.milestone.title}` : '',
          `  CI:        ${overall}${ok ? '' : '  x nao verde'}`,
        ].filter(Boolean);

        if (checks?.statuses.length) {
          lines.push('', '  checks:');
          for (const s of checks.statuses) {
            lines.push(
              `    ${GREEN.has(s.status) ? 'v' : 'x'} ${s.status.padEnd(8)} ${s.context}${s.description ? ` - ${s.description}` : ''}`
            );
          }
        }
        if (failed.length) lines.push(`\n  ${failed.length} check(s) em falha.`);
        if (pending.length) lines.push(`  ${pending.length} check(s) pendentes.`);

        if (pr.body) lines.push('', '--- corpo ---', pr.body.slice(0, 4000));

        // Reviews primeiro: `comments` conta review junto com a conversa, entao
        // a guarda de corte precisa descontar os reviews antes de comparar.
        const reviews = await ctx.host.listReviews(repo, pr.number).catch(() => []);

        if (args.comments !== 0) {
          const all = await ctx.host.listComments(repo, pr.number).catch(() => []);
          const shown = args.comments && args.comments > 0 ? all.slice(-args.comments) : all;
          const expected = Math.max(0, (pr.comments ?? 0) - reviews.length);
          lines.push('', `--- comentarios (${all.length}) ---`);
          if (all.length < expected) {
            lines.push(
              `(!) a API devolveu ${all.length} de ${expected} comentarios: pode haver corte no servidor`
            );
          }
          if (!all.length) lines.push('(nenhum)');
          for (const c of shown) lines.push('', fmtComment(c));
        }

        if (reviews.length) {
          lines.push('', `--- reviews (${reviews.length}) ---`);
          for (const r of reviews) {
            lines.push('', fmtReview(r), (r.body ?? '').trim() || '(sem corpo)');
            if ((r.commentsCount ?? 0) > 0) {
              const inline = await ctx.host
                .listReviewComments(repo, pr.number, r.id)
                .catch(() => []);
              for (const c of inline) lines.push(fmtReviewComment(c));
            }
          }
        }

        return lines.join('\n');
      },
    }),

    pr_checks: tool({
      description:
        'So o estado de CI do head de um PR, e se esta verde. Use como porta antes de `pr_merge` ou ao informar que esta aguardando CI.',
      args: { pr: prArg, repo: repoArgHere },
      async execute(args) {
        const repo = resolve(args.repo);
        const pr = await pull(repo, args.pr);
        const checks = await checksOf(repo, pr);
        const { overall, ok, failed, pending, total } = statusOf(checks);
        if (!total) {
          return `${repo}#${pr.number}: sem checks de CI registrados no head ${(pr.headSha ?? '').slice(0, 7)}. Merge liberado.`;
        }
        return [
          `${repo}#${pr.number} (${pr.headRef} -> ${pr.baseRef}) - CI ${overall}${ok ? ' verde' : ' x'} [${total} checks]`,
          ...(checks?.statuses ?? []).map(
            (s) =>
              `  ${GREEN.has(s.status) ? 'v' : 'x'} ${s.status.padEnd(8)} ${s.context}${s.description ? ` - ${s.description}` : ''}`
          ),
          failed.length ? `\n${failed.length} em falha` : '',
          pending.length ? `${pending.length} pendente(s)` : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    }),

    pr_files: tool({
      description:
        'Arquivos alterados de um PR com adicoes e delecoes em numero de linhas. Para ver o conteudo do diff, use `pr_diff`.',
      args: { pr: prArg, repo: repoArgHere },
      async execute(args) {
        const repo = resolve(args.repo);
        const n = parseRef(args.pr);
        const files = await ctx.host.getPullFiles(repo, n);
        if (!files.length) return `${repo}#${n}: nenhum arquivo (PR vazio ou sem diff).`;
        const add = files.reduce((a, f) => a + f.additions, 0);
        const del = files.reduce((a, f) => a + f.deletions, 0);
        return [
          `${repo}#${n} - ${files.length} arquivo(s), +${add} -${del}`,
          ...files.map(
            (f) =>
              `  ${f.status.padEnd(8)} +${String(f.additions).padEnd(4)} -${String(f.deletions).padEnd(4)} ${f.filename}`
          ),
        ].join('\n');
      },
    }),

    pr_diff: tool({
      description:
        'Diff bruto de um PR. `path` filtra por caminho de arquivo e `grep` por linha; `tail` limita o tamanho.',
      args: {
        pr: prArg,
        repo: repoArgHere,
        path: tool.schema.string().optional().describe('Filtra por caminho de arquivo (regex).'),
        grep: tool.schema.string().optional().describe('Regex sobre as linhas do diff.'),
        tail: tool.schema.number().optional().describe('Ultimas N linhas (default 400).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const n = parseRef(args.pr);
        let diff = await ctx.host.getPullDiff(repo, n);
        if (!diff.trim())
          return `${repo}#${n}: diff vazio (PR sem mudanca ou ainda nao calculada).`;
        if (args.path) diff = filterDiffByPath(diff, args.path);
        if (args.grep) diff = filterDiffByGrep(diff, args.grep);
        return tailLines(diff, args.tail ?? 400);
      },
    }),

    pr_create: tool({
      description:
        'Abre um PR. A descricao passa pela checagem de prosa. Use para branches que moram em branch propria; `pr_list` mostra o que ja esta aberto.',
      args: {
        head: tool.schema.string().describe('Branch de origem (head).'),
        base: tool.schema.string().describe('Branch de destino.'),
        title: tool.schema.string(),
        body: tool.schema.string().optional(),
        draft: tool.schema.boolean().optional(),
        repo: repoArgHere,
      },
      async execute(args) {
        const warn = assertProse(args.body, 'descricao do PR', ctx.config.prose);
        const repo = resolve(args.repo);
        const created = await ctx.host.createPull(repo, {
          head: args.head,
          base: args.base,
          title: args.title,
          body: args.body,
          draft: args.draft,
        });
        ctx.notify(`PR aberto: ${repo}#${created.number}`, 'success');
        return [
          `PR aberto em ${repo}#${created.number}`,
          `  ${created.htmlUrl ?? ''}`,
          `  base=${args.base} head=${args.head}`,
          `Acompanhe com \`pr_checks\` e so mergeie quando verde.`,
          warn,
        ]
          .filter(Boolean)
          .join('\n');
      },
    }),

    pr_merge: tool({
      description:
        'Mergeia um PR. PORTA SEGURA: se houver check de CI em falha ou pendente, RECUSA por padrao, a nao ser que `force: true`. Estilos: merge, squash, rebase, fast-forward-only (o ultimo vira rebase no GitHub, que nao tem esse modo). `delete_branch` limpa a branch.',
      args: {
        pr: prArg,
        repo: repoArgHere,
        style: tool.schema
          .enum(['merge', 'squash', 'rebase', 'fast-forward-only'])
          .optional()
          .describe('Default fast-forward-only.'),
        delete_branch: tool.schema.boolean().optional(),
        force: tool.schema
          .boolean()
          .optional()
          .describe('Ignorar a porta de CI verde (use com justificativa explicita).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const pr = await pull(repo, args.pr);
        const n = pr.number;

        if (pr.merged) return `${repo}#${n} ja foi merged.`;
        if (pr.draft && !args.force) {
          throw new Error(
            `${repo}#${n} e draft. Marque como pronto para revisao ou use force: true explicitamente.`
          );
        }
        // Conflito nao e contornavel: `force` existe para a porta de CI, nao
        // para resolver merge conflict por cima.
        if (pr.mergeable === false) {
          throw new Error(
            `${repo}#${n} tem conflito de merge (mergeable=false). Resolva localmente antes; force: true nao contorna conflito.`
          );
        }

        const checks = await checksOf(repo, pr);
        const { overall, ok, failed, pending } = statusOf(checks);
        if (!ok && !args.force) {
          const detail = [
            failed.length ? `em falha: ${failed.map((s) => s.context).join(', ')}` : '',
            pending.length ? `pendentes: ${pending.map((s) => s.context).join(', ')}` : '',
          ]
            .filter(Boolean)
            .join(' | ');
          throw new Error(
            `CI nao verde em ${repo}#${n} (${overall}) - ${detail}.\n` +
              'Aguarde com `ci_wait` ou `pr_checks`. Para mergear mesmo assim, chame de novo com force: true e explique o porquao.'
          );
        }

        const style = args.style ?? 'fast-forward-only';
        const result = await ctx.host.mergePull(repo, n, style, {
          deleteBranch: args.delete_branch ?? false,
        });
        const after = await pull(repo, n);
        ctx.notify(`PR ${repo}#${n} merged (${style})`, 'success');

        const head = after.headRef ?? '';
        return [
          `PR ${repo}#${n} ${result} -> ${after.baseRef ?? ''}`,
          `  ${after.htmlUrl ?? ''}`,
          args.delete_branch && head ? `  branch ${head} removida` : '',
          '',
          `A branch ${after.baseRef ?? ''} recebeu o commit ${(pr.headSha ?? '').slice(0, 7)}. ` +
            `Confirme a pipeline dela com \`ci_wait\` (repo=${repo}, branch=${after.baseRef}) antes de tratar como deploy.`,
        ]
          .filter(Boolean)
          .join('\n');
      },
    }),

    pr_comment: tool({
      description:
        'Comenta num PR. O texto passa pela checagem de prosa: travessao, ponto e virgula e frases de formula sao recusados.',
      args: { pr: prArg, body: tool.schema.string().describe('Markdown.'), repo: repoArgHere },
      async execute(args) {
        const warn = assertProse(args.body, 'comentario do PR', ctx.config.prose);
        const repo = resolve(args.repo);
        const n = parseRef(args.pr);
        await ctx.host.createComment(repo, n, args.body);
        return [`Comentario publicado em ${repo}#${n}.`, warn].filter(Boolean).join('\n');
      },
    }),

    pr_batch: tool({
      description:
        'Resolve a mesma branch ou PR em varios repos de uma vez e reporta sha e CI de cada um. Aceita lista de repos ou um glob (ex.: `api-*`). Nao mergeia.',
      args: {
        repos: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Slugs de repo; aceita glob.'),
        branch: tool.schema.string().optional().describe('Branch a localizar em todos.'),
        pr: tool.schema.string().optional().describe('Numero de PR, em vez de branch.'),
        state: tool.schema.enum(['open', 'closed', 'all']).optional(),
      },
      async execute(args) {
        if (!args.repos?.length && !args.pr && !args.branch) {
          throw new Error('informe `repos` (lista ou glob), `branch` ou `pr`.');
        }
        const state = args.state ?? 'open';
        const repos = await expandRepos(ctx, args.repos);
        if (!repos.length) return 'Nenhum repo encontrado para esse filtro.';

        const rows: string[] = [];
        let okCount = 0;
        let failCount = 0;
        for (const repo of repos) {
          try {
            const found = args.pr
              ? [await pull(repo, args.pr)]
              : (await ctx.host.listPulls(repo, { state, limit: 50 })).filter(
                  (p) => p.headRef === args.branch
                );
            const pr = found[0];
            if (!pr) {
              rows.push(`  - ${repo.padEnd(22)} - sem PR ${state} para ${args.branch ?? args.pr}`);
              continue;
            }
            const { overall, ok } = statusOf(await checksOf(repo, pr));
            ok ? okCount++ : failCount++;
            rows.push(
              `  ${ok ? 'v' : 'x'} ${repo.padEnd(22)} #${String(pr.number).padEnd(5)} ${(pr.headSha ?? '').slice(0, 7)} CI:${(overall + (ok ? '' : ' x')).padEnd(11)} ${pr.headRef} -> ${pr.baseRef}`
            );
          } catch (e) {
            rows.push(
              `  ! ${repo.padEnd(22)} - ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`
            );
          }
        }
        return [
          `${repos.length} repo(s), ${okCount} verde(s), ${failCount} nao verde(s)`,
          ...rows,
          '',
          'Esta tool nao mergeia. Use `pr_merge` por repo, ou repita aqui so para acompanhar.',
        ].join('\n');
      },
    }),
  };
}

export type { MergeStyle };
