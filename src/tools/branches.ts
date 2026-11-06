import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@opencode-ai/plugin';
import { toolRef, toolSpecs, type ToolSpec } from './spec';
import { DEFAULT_PROMOTE_ORDER as FALLBACK_ORDER } from '../config';
import { pickRepo, type Ctx } from '../core/context';
import type { Compare } from '../providers/types';

/**
 * Tools de branch. `branch_compare` e `branch_protections` falam com a API e
 * funcionam sem clone. `branch_promote` e `commit_list` usam o git local,
 * entao precisam achar o clone.
 *
 * A ordem de promocao e configuravel e o padrao e `staging,production`. Numa
 * ordem, cada branch so pode subir para as que vem depois dela.
 */

export type BranchToolsInput = {
  ctx: Ctx;
  directory: string;
  /** Ordem de promocao. `from` promove para tudo que vem depois dele. */
  promoteOrder?: string[];
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

export type GitResult = { code: number; out: string; err: string };

/** Roda git no repo local. Nunca lanca: devolve o codigo e a saida. */
export function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: 127, out, err: err + String(e) }));
    child.on('close', (code) => resolve({ code: code ?? 0, out, err }));
  });
}

/**
 * Acha o clone de um repo dentro do workspace. Tenta o diretorio com o mesmo
 * nome do repo, depois sobe um nivel, porque o workspace pode ser a raiz de um
 * monorepo.
 */
export function findClone(directory: string, repo: string): string | undefined {
  const short = repo.split('/')[1] ?? repo;
  const direct = join(directory, short);
  if (existsSync(join(direct, '.git'))) return direct;

  for (const base of [join(directory, '..'), directory]) {
    if (!existsSync(base)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(base, e);
      if (!existsSync(join(p, '.git'))) continue;
      if (p === directory) continue;
      const url = e === short ? `/${repo}` : null;
      if (url) return p;
    }
  }
  return undefined;
}

/** Veredito de comparacao, escrito para o agente decidir sem fazer a conta. */
export function compareVerdict(base: string, head: string, cmp: Compare): string {
  if (cmp.ahead === 0 && cmp.behind === 0) return 'ja identicas';
  if (cmp.ahead === 0) return `${base} ja contem ${head}: nao ha o que sincronizar`;
  if (cmp.behind === 0) {
    return `${base} e ancestral de ${head}: ${head} esta ${cmp.ahead} commit(s) a frente (push direto propagaria)`;
  }
  return (
    `divergentes (${head} ${cmp.ahead} a frente, ${base} ${cmp.behind} a frente): ` +
    'push direto seria nao-fast-forward'
  );
}

export function branchTools({
  ctx,
  directory,
  promoteOrder = FALLBACK_ORDER,
}: BranchToolsInput): ToolSpec[] {
  const repoArgHere = repoArg(ctx);
  const resolve = (arg?: string) => pickRepo(ctx, arg);
  const refTool = (name: string) => toolRef(ctx.toolPrefix, name);

  return toolSpecs({
    branch_protections: tool({
      description:
        'Branches do repo e as regras que o servidor exige em cada uma (push liberado ou bloqueado, merge, aprovacoes obrigatorias). Use antes de mergear ou promover: isso vai ao servidor, nao ao git local.',
      args: { repo: repoArgHere },
      async execute(args) {
        const repo = resolve(args.repo);
        const branches = await ctx.host.listBranches(repo).catch(() => []);
        const rules = await ctx.host.getBranchProtections(repo, []).catch(() => []);

        const out = [
          `${repo} - branches: ${branches.map((b) => b.name).join(', ') || '(nenhuma)'}`,
        ];
        if (!rules.length) {
          out.push('\nNenhuma branch protegida configurada no servidor.');
          return out.join('\n');
        }

        out.push('\nregras por branch:');
        for (const r of rules) {
          out.push(`  ${r.branch}: ${r.summary}`);
          const raw = r.raw as
            | {
                required_approvals?: number;
                enable_status_check?: boolean;
                status_check_contexts?: string[];
                dismiss_stale_approvals?: boolean;
                block_on_rejected_reviews?: boolean;
                protected_file_patterns?: string;
              }
            | undefined;
          if (!raw) continue;
          if (raw.enable_status_check) {
            out.push(
              `    status check exigido: ${(raw.status_check_contexts ?? []).join(', ') || '(qualquer)'}`
            );
          }
          if (raw.dismiss_stale_approvals)
            out.push('    aprovacoes antigas sao descartadas a cada push');
          if (raw.block_on_rejected_reviews) out.push('    review negativa bloqueia o merge');
          if (raw.protected_file_patterns)
            out.push(`    padroes protegidos: ${raw.protected_file_patterns}`);
        }
        return out.join('\n');
      },
    }),

    branch_compare: tool({
      description:
        'Compara duas branches direto da API: se uma e ancestral da outra, quantos commits cada uma tem a frente, e se ja ha PR aberto entre elas. Nao usa git local, entao funciona sem clone. Sem `head`, usa a branch atual do clone.',
      args: {
        repo: repoArgHere,
        base: tool.schema.string().describe('Branch de destino.'),
        head: tool.schema
          .string()
          .optional()
          .describe('Branch de origem. Default: branch atual do clone.'),
      },
      async execute(args) {
        const repo = resolve(args.repo);

        // Se head nao veio, tenta achar a branch atual do clone
        let head = args.head;
        if (!head) {
          const clone = findClone(directory, repo);
          if (clone) {
            const r = await git(clone, ['branch', '--show-current']);
            if (r.code === 0 && r.out.trim()) head = r.out.trim();
          }
          if (!head)
            throw new Error(
              '`head` nao informado e nao deu para deduzir a branch atual (sem clone).'
            );
        }

        // O compare 404 quando qualquer uma das refs nao existe, e a API nao
        // diz qual. Listar antes transforma um 404 opaco em "esta branch nao
        // existe" e ainda oferece a lista do que existe.
        const existentes = new Set(
          (await ctx.host.listBranches(repo).catch(() => [])).map((b) => b.name)
        );
        for (const [papel, nome] of [
          ['base', args.base],
          ['head', head],
        ] as const) {
          if (existentes.size && !existentes.has(nome)) {
            throw new Error(
              `branch ${papel} "${nome}" nao existe em ${repo}. Disponiveis: ${[...existentes].join(', ')}`
            );
          }
        }

        const cmp = await ctx.host.compare(repo, args.base, head);
        const prs = await ctx.host
          .listPulls(repo, { state: 'open', head, limit: 50 })
          .catch(() => []);
        const matching = prs.filter((p) => p.headRef === head && p.baseRef === args.base);

        const lines = [
          `${repo}: ${head} -> ${args.base}`,
          `  status:       ${compareVerdict(args.base, head, cmp)}`,
          `  ${head} a frente: ${cmp.ahead}   ${args.base} a frente: ${cmp.behind}`,
        ];

        if (cmp.commits.length) {
          lines.push(
            `  commits a propagar (${cmp.commits.length}):`,
            ...cmp.commits
              .slice(0, 15)
              .map((c) => `    ${c.sha.slice(0, 7)} ${c.message.split('\n')[0].slice(0, 80)}`),
            ...(cmp.commits.length > 15 ? [`    ... +${cmp.commits.length - 15}`] : [])
          );
        }

        lines.push(
          '',
          matching.length
            ? `PR aberto ja existe: ${matching.map((p) => `#${p.number}`).join(', ')}. Use \`pr_view\`.`
            : cmp.ahead === 0
              ? 'Nada a fazer.'
              : cmp.behind === 0
                ? `Sem conflito: \`${refTool('branch_promote')}\` propaga direto. Para revisar por PR, use \`${refTool('pr_create')}\`.`
                : `Ha commits em ${args.base} que nao estao em ${head}: resolva localmente e mande por PR. Nao promova direto.`
        );
        return lines.join('\n');
      },
    }),

    branch_promote: tool({
      description: `Promove uma branch para as branches que vem depois dela na ordem configurada. Faz push direto, sem force. Antes de cada push mostra o que sera propagado e \`dry_run: true\` so relata. Nao abre PR: se o servidor exigir revisao, use \`pr_create\`. Quando so existe a branch padrao, diz que nao ha o que promover.`,
      args: {
        repo: repoArgHere,
        from: tool.schema.string().describe('Branch de origem.'),
        to: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe(
            `Destinos. Default: tudo que vem depois de \`from\` na ordem de promocao (padrao: ${FALLBACK_ORDER.join(' -> ')}, override por PYATILETKA_PROMOTE_ORDER).`
          ),
        dry_run: tool.schema.boolean().optional().describe('So relata, nao faz push.'),
      },
      async execute(args) {
        const repo = resolve(args.repo);

        // Lista branches existentes para inferir ordem se so houver uma branch
        const existentes = new Set(
          (await ctx.host.listBranches(repo).catch(() => [])).map((b) => b.name)
        );

        if (existentes.size === 0) {
          return `${repo}: nenhuma branch encontrada.`;
        }
        if (existentes.size === 1) {
          const only = [...existentes][0];
          if (args.from === only) {
            return `${repo}: so existe a branch "${only}". Nao ha para onde promover.`;
          }
        }

        // Se a branch de origem nao existe, erro claro
        if (!existentes.has(args.from)) {
          throw new Error(
            `branch de origem "${args.from}" nao existe em ${repo}. Disponiveis: ${[...existentes].join(', ')}`
          );
        }

        // Determina a ordem de promocao: se o from esta na ordem configurada, usa ela.
        // Se nao, tenta inferir das branches existentes (ordem alfabetica como fallback).
        const order = promoteOrder;
        const fromIdx = order.indexOf(args.from);
        let targets: string[];

        if (fromIdx !== -1) {
          // Ordem configurada existe
          targets = args.to?.length ? args.to : order.slice(fromIdx + 1);
          if (!targets.length)
            return `${args.from} ja e a ultima branch da ordem; nada a promover.`;

          for (const t of targets) {
            if (order.indexOf(t) <= fromIdx) {
              throw new Error(
                `promocao invalida ${args.from} -> ${t}: a ordem e ${order.join(' -> ')}. ` +
                  'Nunca promova para tras com push direto; use PR.'
              );
            }
          }
        } else {
          // Ordem nao configurada: inferir das branches existentes
          const sorted = [...existentes].sort();
          const inferredFromIdx = sorted.indexOf(args.from);
          if (inferredFromIdx === -1) {
            // Ja verificado acima que a branch existe, mas por seguranca
            throw new Error(`branch "${args.from}" nao encontrada nas branches existentes.`);
          }
          const inferredOrder = sorted;
          targets = args.to?.length ? args.to : inferredOrder.slice(inferredFromIdx + 1);
          if (!targets.length)
            return `${args.from} ja e a ultima branch conhecida; nada a promover.`;
        }

        const report: string[] = [];
        const pushed: string[] = [];

        /** Fetch e push de `from` para `to`. `ahead` e null quando e criacao. */
        const doPush = async (to: string, ahead: number | null): Promise<void> => {
          const clone = findClone(directory, repo);
          if (!clone) {
            report.push(
              `  ${args.from} -> ${to}: SEM CLONE LOCAL de ${repo}. Faca na mao: git -C <repo> push origin ${args.from}:${to}`
            );
            return;
          }
          const fetch = await git(clone, ['fetch', 'origin', '--prune', '--quiet']);
          if (fetch.code !== 0) {
            report.push(
              `  ${args.from} -> ${to}: fetch falhou (${fetch.err.trim().slice(0, 120)})`
            );
            return;
          }
          const push = await git(clone, ['push', 'origin', `${args.from}:${to}`]);
          if (push.code !== 0) {
            const first = (push.err || push.out).trim().split('\n')[0]?.slice(0, 160) ?? '';
            report.push(`  ${args.from} -> ${to}: push falhou (${first})`);
            return;
          }
          pushed.push(to);
          report.push(
            ahead === null
              ? `  ${args.from} -> ${to}: branch criada (o destino nao existia)`
              : `  ${args.from} -> ${to}: ${ahead} commit(s) propagados (push fast-forward)`
          );
        };

        for (const to of targets) {
          // Destino novo nao tem compare: e o proprio push que cria a branch.
          if (!existentes.has(to)) {
            if (args.dry_run) {
              report.push(
                `  ${args.from} -> ${to}: destino nao existe, o push criaria a branch [dry-run]`
              );
              continue;
            }
            await doPush(to, null);
            continue;
          }

          const cmp = await ctx.host.compare(repo, to, args.from).catch((e: unknown) => {
            report.push(
              `  ${args.from} -> ${to}: pulado (${e instanceof Error ? e.message : String(e)})`
            );
            return undefined;
          });
          if (!cmp) continue;

          if (cmp.ahead === 0) {
            report.push(`  ${args.from} -> ${to}: nada a fazer (${to} ja contem ${args.from})`);
            continue;
          }
          if (cmp.behind > 0) {
            report.push(
              `  ${args.from} -> ${to}: DIVERGENTE (${args.from} ${cmp.ahead} a frente, ${to} ${cmp.behind} a frente). Push direto seria nao-fast-forward.`
            );
            continue;
          }
          if (args.dry_run) {
            report.push(`  ${args.from} -> ${to}: propagaria ${cmp.ahead} commit(s) [dry-run]`);
            continue;
          }

          await doPush(to, cmp.ahead);
        }

        ctx.notify(
          pushed.length
            ? `${repo}: ${args.from} -> ${pushed.join(', ')}`
            : `${repo}: nada promovido`,
          pushed.length ? 'success' : 'info'
        );

        return [
          `${repo}: promocao ${args.from} -> [${targets.join(', ')}]${args.dry_run ? ' (dry-run)' : ''}`,
          ...report,
          '',
          pushed.length
            ? `Branches atualizadas: ${pushed.join(', ')}.\n` +
              `O CI de cada uma roda sozinho. Confirme com \`ci_wait\` (repo=${repo}, branch=<branch>) antes de tratar como deploy.`
            : 'Nada foi propagado.',
        ].join('\n');
      },
    }),

    commit_list: tool({
      description:
        'Commits locais de um repo (git log), filtrados por autor e janela de datas. Le o clone do workspace, entao mostra o que foi feito localmente e nao o que esta na API.',
      args: {
        repo: repoArgHere,
        since: tool.schema.string().optional().describe('YYYY-MM-DD (inclusive).'),
        until: tool.schema.string().optional().describe('YYYY-MM-DD (inclusive).'),
        author: tool.schema
          .string()
          .optional()
          .describe('Filtra por nome ou e-mail do autor (substring, sem diferenciar caixa).'),
        branch: tool.schema
          .string()
          .optional()
          .describe('Branch ou ref para o log. Default: --all.'),
        limit: tool.schema.number().optional().describe('Max commits (default 80).'),
      },
      async execute(args) {
        const repo = resolve(args.repo);
        const clone = findClone(directory, repo);
        if (!clone) {
          return (
            `SEM CLONE LOCAL de ${repo} no workspace. Rode o commit por la: ` +
            `git -C <repo> log --since=... --author=...`
          );
        }

        const logArgs = ['log', '--pretty=format:%h%x1f%cI%x1f%an%x1f%s'];
        logArgs.push(args.branch ?? '--all');
        if (args.since) logArgs.push(`--since=${args.since}T00:00:00`);
        if (args.until) logArgs.push(`--until=${args.until}T23:59:59`);
        if (args.author) logArgs.push(`--author=${args.author}`);
        logArgs.push(`--max-count=${args.limit ?? 80}`);

        const r = await git(clone, logArgs);
        if (r.code !== 0) {
          return `git log falhou em ${repo}: ${(r.err || r.out).trim().slice(0, 200)}`;
        }
        const lines = r.out.split('\n').filter(Boolean);
        if (!lines.length) return `${repo}: nenhum commit na janela.`;
        return [
          `${repo}: ${lines.length} commit(s)`,
          ...lines.map((l) => `  ${l.split('\x1f').join(' | ')}`),
        ].join('\n');
      },
    }),
  });
}
