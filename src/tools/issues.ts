import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { assertProse } from '../prose';
import { bindingOf, expandRepos, parseRef, parseRefs, pickRepo, type Ctx } from '../core/context';
import { clearBinding, writeBinding } from '../core/binding';
import { classify, dateField, fmtComment, fmtIssue, priorityOf } from '../core/format';
import { findMilestone, inMilestone, milestoneQueue, type Deps } from '../core/milestone';
import { buildBody, listTemplates, loadTemplate } from '../core/template';
import type { Issue, Milestone } from '../providers/types';

/**
 * Tools de issue e marco. Todas falam so com a interface `GitHost` e resolvem o
 * repo pela ordem: argumento, vinculo da sessao, ambiente ou clone.
 */

export type IssueToolsInput = {
  ctx: Ctx;
  directory: string;
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

const issueArg = tool.schema.string().describe("Numero da issue (ex.: '77')");

/** Issue da tool ou da issue vinculada a sessao. */
function target(
  ctx: Ctx,
  directory: string,
  args: { repo?: string; issue?: string },
  sessionID: string
): { repo: string; n: number } {
  const binding = bindingOf(directory, sessionID);
  const repo = pickRepo(ctx, args.repo, binding);
  const n = parseRef(args.issue ?? binding?.issue);
  if (!Number.isFinite(n)) {
    throw new Error('Nenhuma issue informada nem vinculada a sessao. Use `issue_bind` primeiro.');
  }
  return { repo, n };
}

async function milestoneDeps(ctx: Ctx, repo: string, items: Issue[]): Promise<Deps> {
  const inside = new Map<number, number[]>();
  const outside = new Map<number, number[]>();
  const byNumber = new Set(items.map((i) => i.number));
  await Promise.all(
    items.map(async (i) => {
      // Provider sem suporte a dependencia nativa nao pode derrubar a fila.
      const all = await ctx.host.listDependencies(repo, i.number).catch(() => [] as Issue[]);
      inside.set(
        i.number,
        all.filter((d) => byNumber.has(d.number)).map((d) => d.number)
      );
      outside.set(
        i.number,
        all.filter((d) => !byNumber.has(d.number)).map((d) => d.number)
      );
    })
  );
  return { inside, outside };
}

export function issueTools({ ctx, directory }: IssueToolsInput): Record<string, ToolDefinition> {
  const repoArgHere = repoArg(ctx);
  const resolve = (arg?: string) => pickRepo(ctx, arg);

  return {
    issue_bind: tool({
      description:
        'Vincula ESTA sessao a uma issue. Toda conversa passa a receber o corpo e os comentarios da issue automaticamente. Chame sempre que comecar ou continuar trabalho.',
      args: {
        issue: issueArg,
        repo: repoArgHere,
        milestone: tool.schema
          .string()
          .optional()
          .describe('Marco/epico ao qual a issue pertence. Sem isso, usa o marco da issue.'),
      },
      async execute(args, toolCtx) {
        const repo = pickRepo(ctx, args.repo);
        const n = parseRef(args.issue);
        if (!Number.isFinite(n)) throw new Error(`issue invalida: ${args.issue}`);
        const issue = await ctx.host.getIssue(repo, n);
        const milestone = args.milestone ?? issue.milestone?.title;
        const file = writeBinding(directory, toolCtx.sessionID, {
          repo,
          issue: n,
          milestone,
          boundAt: new Date().toISOString(),
        });
        ctx.notify(`Vinculado: ${repo}#${n} - ${issue.title}`);
        return `Vinculado a ${repo}#${n} (arquivo: ${file})\n\n${fmtIssue(issue)}`;
      },
    }),

    issue_unbind: tool({
      description: 'Desvincula a sessao da issue atual.',
      args: {},
      async execute(_args, toolCtx) {
        const b = bindingOf(directory, toolCtx.sessionID);
        if (!b) return 'Sessao ja estava desvinculada.';
        clearBinding(directory, toolCtx.sessionID);
        ctx.notify('Sessao desvinculada');
        return `Sessao desvinculada (estava em ${b.repo}#${b.issue ?? '-'}).`;
      },
    }),

    issue_binding: tool({
      description: 'Mostra a qual issue esta sessao esta vinculada, ou diz que nao ha vinculo.',
      args: {},
      async execute(_args, toolCtx) {
        const b = bindingOf(directory, toolCtx.sessionID);
        if (!b) return 'Nenhuma issue vinculada nesta sessao.';
        const issue = b.issue
          ? await ctx.host.getIssue(b.repo, b.issue).catch(() => undefined)
          : undefined;
        return [
          `repo=${b.repo} issue=${b.issue ?? '-'} marco=${b.milestone ?? '-'} desde=${b.boundAt}`,
          issue ? fmtIssue(issue) : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    }),

    issue_view: tool({
      description:
        'Le uma issue (titulo, corpo, labels, marco, estado), resolve as dependencias e traz TODOS os comentarios: eles sao o log de trabalho e contexto obrigatorio. Use antes de trabalhar.',
      args: {
        issue: issueArg,
        repo: repoArgHere,
        comments: tool.schema
          .number()
          .optional()
          .describe(
            'Quantos comentarios trazer, dos mais recentes. Default: todos. Use 0 para pular.'
          ),
      },
      async execute(args, toolCtx) {
        const { repo, n } = target(ctx, directory, args, toolCtx.sessionID);
        const issue = await ctx.host.getIssue(repo, n);
        const out = [fmtIssue(issue)];

        const deps = await ctx.host.listDependencies(repo, n).catch(() => [] as Issue[]);
        out.push(
          deps.length
            ? `  depende de (${deps.length}) - ${deps
                .map(
                  (d) =>
                    `#${d.number} [${d.state === 'closed' ? 'OK' : classify(d)}] ${d.title.slice(0, 60)}`
                )
                .join('\n              ')}`
            : '  depende de: nada'
        );

        out.push('', '--- corpo ---', issue.body ?? '(vazio)');

        if (args.comments !== 0) {
          const all = await ctx.host.listComments(repo, n);
          const shown = args.comments && args.comments > 0 ? all.slice(-args.comments) : all;
          out.push('', `--- comentarios (${all.length}) ---`);
          if (all.length && all.length < (issue.comments ?? 0)) {
            out.push(
              `(!) a API devolveu ${all.length} de ${issue.comments} comentarios: pode haver corte no servidor`
            );
          }
          if (!all.length) out.push('(nenhum)');
          for (const c of shown) out.push('', fmtComment(c));
        }

        return out.join('\n');
      },
    }),

    issue_list: tool({
      description:
        'Lista issues (default: abertas). Filtra por marco, estado logico (todo/in-progress/blocked/need-info/done), autor, assignee e janela de datas. Passe `repos` (lista ou glob) para varrer varios repos.',
      args: {
        repo: repoArgHere,
        repos: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Varios repos; aceita glob (infra-*) e lista. Ignorado se `repo` vier.'),
        milestone: tool.schema
          .string()
          .optional()
          .describe('Id do marco (`13`) ou titulo parcial.'),
        state: tool.schema.enum(['open', 'closed', 'all']).optional().describe('Default open.'),
        filter: tool.schema
          .enum(['todo', 'in-progress', 'blocked', 'need-info', 'done'])
          .optional()
          .describe('Filtro logico; so faz sentido com state=open/all.'),
        author: tool.schema.string().optional().describe('Login do autor.'),
        assignee: tool.schema.string().optional().describe('Login do assignee.'),
        since: tool.schema
          .string()
          .optional()
          .describe('YYYY-MM-DD[:created|:updated|:closed] >= data (default created).'),
        until: tool.schema
          .string()
          .optional()
          .describe('YYYY-MM-DD[:created|:updated|:closed] <= data (default created).'),
        limit: tool.schema.number().optional().describe('Max itens (default 60).'),
      },
      async execute(args) {
        const state = args.state ?? 'open';
        const limit = args.limit ?? 60;
        const [sinceDay, sinceKind = 'created'] = (args.since ?? '').split(':');
        const [untilDay, untilKind = 'created'] = (args.until ?? '').split(':');

        const one = async (repo: string) => {
          let items = await ctx.host.listIssues(repo, state);
          if (args.milestone) items = items.filter((i) => inMilestone(i, args.milestone!));
          if (args.filter) items = items.filter((i) => classify(i) === args.filter);
          if (args.author) {
            const who = args.author.toLowerCase();
            items = items.filter((i) => i.user?.toLowerCase() === who);
          }
          if (args.assignee) {
            const who = args.assignee.toLowerCase();
            items = items.filter((i) => i.assignees?.some((a) => a.toLowerCase() === who));
          }
          if (sinceDay) {
            items = items.filter((i) => (dateField(sinceKind, i) ?? '') >= `${sinceDay}T00:00:00Z`);
          }
          // Issue sem closed_at nao conta como "fechada ate aqui": string vazia
          // passaria no <= e traria de volta toda issue ainda aberta.
          if (untilDay) {
            items = items.filter((i) => {
              const v = dateField(untilKind, i);
              return v ? v <= `${untilDay}T23:59:59Z` : untilKind !== 'closed';
            });
          }
          return { repo, items };
        };

        const sorted = (items: Issue[]) =>
          items.sort((a, b) => priorityOf(a) - priorityOf(b) || a.number - b.number);

        // Repo unico quando veio argumento ou quando existe padrao. So varre a
        // org quando o pedido foi `repos` (ou quando nao ha padrao nenhum).
        const single = args.repo ?? (args.repos?.length ? undefined : ctx.defaultRepo);
        if (!single) {
          const repos = await expandRepos(ctx, args.repos);
          if (!repos.length) return 'Nenhum repo informado.';
          const blocks: string[] = [];
          let total = 0;
          for (const repo of repos) {
            const { items } = await one(repo).catch(() => ({ repo, items: [] as Issue[] }));
            if (!items.length) continue;
            total += items.length;
            const header = `${repo} ${'-'.repeat(Math.max(0, 44 - repo.length))}`;
            blocks.push(`${header}\n${sorted(items).slice(0, limit).map(fmtIssue).join('\n\n')}`);
          }
          if (!blocks.length)
            return 'Nenhuma issue encontrada com esses filtros nos repos indicados.';
          return [`${total} issue(s)`, '', blocks.join('\n\n')].join('\n');
        }

        const { items } = await one(resolve(single));
        if (!items.length) return 'Nenhuma issue encontrada com esses filtros.';
        return sorted(items).slice(0, limit).map(fmtIssue).join('\n\n');
      },
    }),

    issue_template_list: tool({
      description:
        'Lista os templates de issue do repo (.gitea/issue_template/ e .github/ISSUE_TEMPLATE/) com o conteudo de cada um. Use antes de `issue_create` para saber o formato de `objetivo` e `criterios` que o plugin le.',
      args: { repo: repoArgHere },
      async execute(args) {
        const repo = resolve(args.repo);
        const all = listTemplates(directory, repo);
        if (!all.length) {
          return (
            `Nenhum template em ${repo}: .gitea/issue_template/ e .github/ISSUE_TEMPLATE/ nao existem. ` +
            '`issue_create` funciona sem template, mas o corpo sai sem as secoes que o `milestone_view` le.'
          );
        }
        return all
          .map((t) =>
            [
              `-- ${t.name}.md  (${t.file})`,
              t.about ? `  about: ${t.about}` : '',
              t.labels.length ? `  labels: ${t.labels.join(', ')}` : '',
              '',
              t.body,
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n\n');
      },
    }),

    issue_create: tool({
      description:
        'Cria uma issue (task) no repo. Com `template` e sem `body`, monta o corpo a partir dos campos. `depende` grava as dependencias na secao de dependencias da API, que e o que o `milestone_view` le para montar a fila. O texto passa pela checagem de prosa: travessao, ponto e virgula e frases de formula sao recusados.',
      args: {
        title: tool.schema.string(),
        body: tool.schema
          .string()
          .optional()
          .describe(
            'Corpo markdown. Com `template`, ignore: e montado a partir dos campos abaixo.'
          ),
        template: tool.schema
          .string()
          .optional()
          .describe('Nome do template do repo (ex.: `task`). Mutuamente exclusivo com `body`.'),
        objetivo: tool.schema
          .string()
          .optional()
          .describe('Secao `## Objetivo`: o que muda quando fechar.'),
        criterios: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Secao `## Criterio de aceite`: um item verificavel por item, vira checkbox.'),
        depende: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe(
            'Issues que esta passa a esperar (`56`, `#57`). Vai para a secao de dependencias da API, nao para o corpo.'
          ),
        contexto: tool.schema
          .string()
          .optional()
          .describe('Secao `## Contexto`: o que nao cabe em uma frase.'),
        milestone: tool.schema.string().optional().describe('Id do marco ou titulo parcial.'),
        labels: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe(
            "Ex.: ['Kind/Enhancement','Priority/Medium']. Sem `template`, o padrao e Priority/Medium."
          ),
        repo: repoArgHere,
      },
      async execute(args) {
        const repo = resolve(args.repo);
        if (args.body && args.template) throw new Error('use `body` ou `template`, nao os dois.');

        let body = args.body ?? '';
        let labels = args.labels;
        let title = args.title;

        if (args.template) {
          const tpl = loadTemplate(directory, repo, args.template);
          body = buildBody(args);
          // Prefixo e labels do frontmatter, como a UI faria.
          if (tpl.titlePrefix && !title.startsWith(tpl.titlePrefix)) {
            title = `${tpl.titlePrefix}${title}`;
          }
          if (!labels?.length && tpl.labels.length) labels = tpl.labels;
        } else if (!labels?.length) {
          // Sem template, prioridade default para o `milestone_view` ordenar.
          labels = ['Priority/Medium'];
        }

        const warn = assertProse(body, 'corpo da issue', ctx.config.prose);
        const created = await ctx.host.createIssue(repo, { title, body, labels: labels ?? [] });

        if (args.milestone) {
          const all = await ctx.host.listMilestones(repo);
          const ms = findMilestone(all, args.milestone, repo);
          await ctx.host.setIssueMilestone(repo, created.number, ms.id);
        }

        // Dependencias vao pela API, nao por texto no corpo: e o que a UI
        // mostra e o que o `milestone_view` le.
        const blockers = parseRefs(args.depende);
        if (blockers.length) await ctx.host.addDependencies(repo, created.number, blockers);

        ctx.notify(`Issue criada: ${repo}#${created.number}`, 'success');
        const saved = await ctx.host
          .listDependencies(repo, created.number)
          .catch(() => [] as Issue[]);
        const after = await ctx.host.getIssue(repo, created.number);
        return [
          `Criada a partir de ${args.template ? `template "${args.template}"` : 'body literal'}.`,
          fmtIssue(after),
          blockers.length
            ? `  depende de: ${saved.map((d) => `#${d.number}`).join(', ')}`
            : '  depende de: nada',
          '',
          '--- corpo ---',
          body,
          warn,
        ]
          .filter(Boolean)
          .join('\n');
      },
    }),

    issue_depend: tool({
      description:
        'Gerencia as dependencias de uma issue, as mesmas da secao Dependencias da UI. `add` faz a issue esperar pelas citadas, `remove` tira a aresta. E o que o `milestone_view` le para montar a fila do marco, entao nao escreva dependencias como texto no corpo.',
      args: {
        issue: issueArg,
        add: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Issues que passam a bloquear a alvo.'),
        remove: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Issues que deixam de bloquear a alvo.'),
        repo: repoArgHere,
      },
      async execute(args, toolCtx) {
        const { repo, n } = target(ctx, directory, args, toolCtx.sessionID);
        const add = parseRefs(args.add);
        const rm = parseRefs(args.remove);
        if (!add.length && !rm.length) throw new Error('informe `add` e/ou `remove`.');

        if (add.length) await ctx.host.addDependencies(repo, n, add);
        for (const b of rm) await ctx.host.removeDependency(repo, n, b);

        const after = await ctx.host.listDependencies(repo, n).catch(() => [] as Issue[]);
        return [
          `#${n} - dependencias:`,
          ...(after.length
            ? after.map(
                (d) =>
                  `  #${d.number} [${d.state}] ${d.state === 'closed' ? 'OK' : classify(d)} - ${d.title}`
              )
            : ['  (nenhuma)']),
        ].join('\n');
      },
    }),

    issue_comment: tool({
      description:
        'Comenta na issue vinculada (ou numa informada). Use para registrar progresso, decisao, bloqueio e evidencia, porque o log de trabalho vive aqui. O texto passa pela checagem de prosa.',
      args: {
        body: tool.schema
          .string()
          .describe('Markdown. Prefira `## Update YYYY-MM-DD` para blocos.'),
        issue: tool.schema
          .string()
          .optional()
          .describe('Numero da issue; padrao = issue vinculada a sessao.'),
        repo: repoArgHere,
      },
      async execute(args, toolCtx) {
        const { repo, n } = target(ctx, directory, args, toolCtx.sessionID);
        const warn = assertProse(args.body, 'comentario da issue', ctx.config.prose);
        await ctx.host.createComment(repo, n, args.body);
        return [`Comentario publicado em ${repo}#${n}.`, warn].filter(Boolean).join('\n');
      },
    }),

    issue_update: tool({
      description:
        'Atualiza titulo, corpo e labels da issue. O corpo passa pela checagem de prosa. Use `add_labels` para transicao de status: uma label `Status/` nova substitui a anterior.',
      args: {
        issue: tool.schema.string().optional(),
        repo: repoArgHere,
        add_labels: tool.schema.array(tool.schema.string()).optional(),
        remove_labels: tool.schema.array(tool.schema.string()).optional(),
        title: tool.schema.string().optional(),
        body: tool.schema.string().optional().describe('Novo corpo da issue (substitui o atual).'),
      },
      async execute(args, toolCtx) {
        const { repo, n } = target(ctx, directory, args, toolCtx.sessionID);
        const warn = assertProse(args.body, 'corpo da issue', ctx.config.prose);

        const patch: { title?: string; body?: string; labels?: string[] } = {};
        if (args.title) patch.title = args.title;
        if (args.body !== undefined) patch.body = args.body;

        if (args.add_labels?.length || args.remove_labels?.length) {
          const cur = await ctx.host.getIssue(repo, n);
          const next = new Set(cur.labels);
          for (const l of args.remove_labels ?? []) next.delete(l);
          for (const l of args.add_labels ?? []) next.add(l);
          // Transicao de status e exclusiva: a familia nova substitui a antiga.
          const added = args.add_labels?.filter((l) => l.startsWith('Status/')) ?? [];
          if (added.length) {
            for (const l of [...next]) {
              if (l.startsWith('Status/') && !added.includes(l)) next.delete(l);
            }
          }
          patch.labels = [...next];
        }

        if (!Object.keys(patch).length) throw new Error('nada para atualizar.');
        const after = await ctx.host.updateIssue(repo, n, patch);
        return [`Atualizado:\n${fmtIssue(after)}`, warn].filter(Boolean).join('\n');
      },
    }),

    issue_close: tool({
      description:
        'Fecha a issue vinculada (ou a informada). O comentario de fechamento passa pela checagem de prosa. So use com o criterio de aceite verificado.',
      args: {
        issue: tool.schema.string().optional(),
        repo: repoArgHere,
        comment: tool.schema
          .string()
          .optional()
          .describe('Comentario de fechamento; se vazio, nao comenta.'),
        state_reason: tool.schema
          .enum(['completed', 'not_planned'])
          .optional()
          .describe('Motivo do fechamento (default: completed).'),
      },
      async execute(args, toolCtx) {
        const { repo, n } = target(ctx, directory, args, toolCtx.sessionID);
        const warn = assertProse(args.comment, 'comentario de fechamento', ctx.config.prose);
        if (args.comment) await ctx.host.createComment(repo, n, args.comment);
        await ctx.host.updateIssue(repo, n, {
          state: 'closed',
          stateReason: args.state_reason ?? 'completed',
        });
        ctx.notify(`Issue fechada: ${repo}#${n}`, 'success');
        return [`${repo}#${n} fechada.`, warn].filter(Boolean).join('\n');
      },
    }),

    issue_reopen: tool({
      description: 'Reabre uma issue.',
      args: { issue: tool.schema.string().optional(), repo: repoArgHere },
      async execute(args, toolCtx) {
        const { repo, n } = target(ctx, directory, args, toolCtx.sessionID);
        await ctx.host.updateIssue(repo, n, { state: 'open' });
        return `${repo}#${n} reaberta.`;
      },
    }),

    milestone_view: tool({
      description:
        'Estado completo de um marco em UMA chamada: cabecalho com contagem por estado, fila de dependencias e a proxima issue sugerida. Aceita id numerico (`13`) ou titulo parcial (`Lab`). Substitui milestone_list + issue_list + varias issue_view.',
      args: {
        milestone: tool.schema
          .string()
          .describe('Id do marco (`13`, `#13`) ou titulo parcial (`Lab`).'),
        repo: repoArgHere,
        state: tool.schema
          .enum(['open', 'closed', 'all'])
          .optional()
          .describe('Estado das issues (default open; use `all` para ver o historico).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const state = args.state ?? 'open';
        const all = await ctx.host.listMilestones(repo);
        const ms = findMilestone(all, args.milestone, repo);
        const items = (await ctx.host.listIssues(repo, state)).filter((i) =>
          inMilestone(i, String(ms.id))
        );
        if (!items.length) return `${repo} marco #${ms.id} ${ms.title} sem issues ${state}.`;

        const deps = await milestoneDeps(ctx, repo, items);
        const q = milestoneQueue(repo, ms, items, deps);
        return [...q.head, '', ...q.sections, ...q.suggestion].join('\n').trimEnd();
      },
    }),

    milestone_list: tool({
      description:
        'Lista marcos com contagem (fechadas/total) e descricao resumida. Passe `milestone` (id ou titulo parcial) para resolver um so. Para ver as issues e a fila de dependencias, use `milestone_view`.',
      args: {
        repo: repoArgHere,
        state: tool.schema.enum(['open', 'closed', 'all']).optional(),
        milestone: tool.schema
          .string()
          .optional()
          .describe('Id (`13`) ou titulo parcial: resolve e mostra so esse marco.'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const all = await ctx.host.listMilestones(repo);
        const items = args.milestone
          ? [findMilestone(all, args.milestone, repo)]
          : all.filter((m) => !args.state || m.state === args.state);
        if (!items.length) return `Nenhum marco ${args.state ?? 'aberto'} em ${repo}.`;
        return items
          .map((m: Milestone) => {
            const total = m.openIssues + m.closedIssues;
            const pct = total ? Math.round((m.closedIssues / total) * 100) : 0;
            return [
              `#${m.id} [${m.state}] ${m.title} - ${m.closedIssues}/${total} (${pct}%)`,
              m.dueOn ? `  due: ${m.dueOn}` : '',
              m.description
                ? `  ${m.description.split('\n').slice(0, 3).join(' ').slice(0, 300)}`
                : '',
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n');
      },
    }),

    milestone_create: tool({
      description:
        'Cria um marco/epico no repo. Use antes de criar as issues que pertencem a ele. A descricao passa pela checagem de prosa.',
      args: {
        title: tool.schema.string(),
        description: tool.schema.string().optional(),
        state: tool.schema.enum(['open', 'closed']).optional(),
        repo: repoArgHere,
      },
      async execute(args) {
        const warn = assertProse(args.description, 'descricao do marco', ctx.config.prose);
        const repo = resolve(args.repo);
        const dupe = (await ctx.host.listMilestones(repo)).find(
          (m) => m.title.toLowerCase() === args.title.toLowerCase()
        );
        if (dupe) throw new Error(`marco ja existe em ${repo}: #${dupe.id} ${dupe.title}`);
        const created = await ctx.host.createMilestone(repo, {
          title: args.title,
          description: args.description,
        });
        return [`Marco criado: #${created.id} [${created.state}] ${created.title}`, warn]
          .filter(Boolean)
          .join('\n');
      },
    }),

    milestone_update: tool({
      description:
        'Atualiza titulo, descricao ou estado de um marco (por id ou titulo). A descricao passa pela checagem de prosa.',
      args: {
        milestone: tool.schema.string().describe('Id do marco ou titulo.'),
        repo: repoArgHere,
        title: tool.schema.string().optional(),
        description: tool.schema.string().optional(),
        state: tool.schema.enum(['open', 'closed']).optional(),
      },
      async execute(args) {
        const warn = assertProse(args.description, 'descricao do marco', ctx.config.prose);
        const repo = resolve(args.repo);
        const all = await ctx.host.listMilestones(repo);
        const ms = findMilestone(all, args.milestone, repo);
        const patch: { title?: string; description?: string; state?: 'open' | 'closed' } = {};
        if (args.title) patch.title = args.title;
        if (args.description !== undefined) patch.description = args.description;
        if (args.state) patch.state = args.state;
        if (!Object.keys(patch).length) throw new Error('nada para atualizar.');
        const after = await ctx.host.updateMilestone(repo, ms.id, patch);
        return [`Marco atualizado: #${after.id} [${after.state}] ${after.title}`, warn]
          .filter(Boolean)
          .join('\n');
      },
    }),
  };
}
