import type { Hooks, Plugin } from '@opencode-ai/plugin';
import { createCtx, type Client, type Ctx } from './core/context';
import { readBinding } from './core/binding';
import { fmtComment, fmtIssue } from './core/format';
import { branchTools } from './tools/branches';
import { issueTools } from './tools/issues';
import { pipelineTools } from './tools/pipeline';
import { createPushHook } from './tools/push-hook';
import { pullTools } from './tools/pulls';

/**
 * pyatiletka: fluxo de issues, marcos, PRs e CI para agentes, em Gitea e
 * GitHub.
 *
 * A config vem do ambiente. Sem token ou sem provider a carga falha com
 * mensagem, e nao com `undefined` no meio de uma tool.
 */

export const TOOL_NAMES = [
  // issue e marco
  'issue_bind',
  'issue_unbind',
  'issue_binding',
  'issue_view',
  'issue_list',
  'issue_template_list',
  'issue_create',
  'issue_depend',
  'issue_comment',
  'issue_update',
  'issue_close',
  'issue_reopen',
  'milestone_view',
  'milestone_list',
  'milestone_create',
  'milestone_update',
  // pull request
  'pr_list',
  'pr_view',
  'pr_checks',
  'pr_files',
  'pr_diff',
  'pr_comment',
  'pr_create',
  'pr_merge',
  'pr_batch',
  // pipeline
  'ci_runs',
  'ci_run',
  'ci_wait',
  'ci_logs',
  'ci_config',
  'ci_dispatch',
  'ci_runners',
  // branch
  'branch_protections',
  'branch_compare',
  'branch_promote',
  'commit_list',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Monta o contexto da sessao e o conjunto de tools. Os dois `src/tools/*` sao
 * grupos puros: recebem o `Ctx` e devolvem as tools. Tudo que depende de
 * sessao e de hook vive aqui.
 */
export function createTools(ctx: Ctx, directory: string) {
  return {
    ...issueTools({ ctx, directory }),
    ...pullTools({ ctx }),
    ...pipelineTools({ ctx, defaultBranch: ctx.config.defaultBranch ?? '' }),
    ...branchTools({
      ctx,
      directory,
      promoteOrder: ctx.config.promoteOrder,
    }),
  };
}

/** Regras que o agente segue enquanto o vinculo estiver ativo. */
function bindingPrompt(repo: string, issue?: number, milestone?: string): string {
  return [
    '',
    '## Contexto da sessao: issue vinculada',
    '',
    `Esta sessao esta vinculada a **${repo}#${issue}**${
      milestone ? ` (marco/epico: ${milestone})` : ''
    }.`,
    '',
    'Regras enquanto o vinculo estiver ativo:',
    '- Trabalhe **dentro** do escopo e do criterio de aceite desta issue.',
    '- Os comentarios abaixo sao o log de trabalho e contexto obrigatorio: leia-os antes de agir.',
    '- Registre progresso com `issue_comment` (blocos `## Update YYYY-MM-DD`) em vez de narrar de novo.',
    '- Marque `Status/In Progress` ao comecar. Se travar, use `Status/Blocked`, comente e **pergunte** ao usuario.',
    '- Nao feche a issue sem verificar o criterio de aceite.',
    '- Pendencias descobertas viram `issue_create` no mesmo marco.',
  ].join('\n');
}

/**
 * Os tres hooks que dependem de sessao. Fica separado da carga do plugin para
 * que o `Ctx` possa ser injetado: assim o teste monta um `FakeForge` e nao
 * chama a rede.
 */
export function createHooks(
  ctx: Ctx,
  root: string
): Pick<
  Hooks,
  'experimental.chat.system.transform' | 'experimental.session.compacting' | 'tool.execute.after'
> {
  return {
    /**
     * Injeta o contexto da issue vinculada em todo turno da sessao. Falha ao
     * ler a issue nao derruba o turno: o vinculo continua valendo e o aviso
     * vai junto.
     */
    'experimental.chat.system.transform': async (input, output) => {
      const b = input.sessionID ? readBinding(root, input.sessionID) : undefined;
      if (!b) return;

      let head = bindingPrompt(b.repo, b.issue, b.milestone);
      if (b.issue) {
        try {
          const issue = await ctx.forge.getIssue(b.repo, b.issue);
          head += `\n### ${fmtIssue(issue)}\n\n<details><summary>corpo da issue</summary>\n\n${issue.body ?? ''}\n\n</details>\n`;
          head += `\nlabels: ${issue.labels.length ? issue.labels.join(', ') : '(nenhuma)'}\n`;

          const comments = await ctx.forge.listComments(b.repo, b.issue).catch(() => []);
          if (comments.length) {
            head += `\n### Comentarios (${comments.length}): log de trabalho\n`;
            if (comments.length < (issue.comments ?? 0)) {
              head += `> a API devolveu ${comments.length} de ${issue.comments} comentarios\n`;
            }
            for (const c of comments) head += `\n${fmtComment(c)}\n`;
          }
        } catch (e) {
          head += `\n> Falha ao ler a issue: ${e instanceof Error ? e.message : String(e)}\n`;
        }
      }

      output.system.push(head);
    },

    /** Preserva o vinculo atraves de compaction. */
    'experimental.session.compacting': async (input, output) => {
      const b = readBinding(root, input.sessionID);
      if (!b) return;
      output.context.push(
        `Sessao vinculada a issue ${b.repo}#${b.issue}${
          b.milestone ? ` (marco ${b.milestone})` : ''
        }. Ao retomar, chame issue_view nessa issue: ela traz o corpo e TODOS os comentarios, que sao o log de trabalho. Continue de onde parou e registre progresso com issue_comment.`
      );
    },

    /** Push espera o CI antes de devolver. Ver `src/tools/push-hook.ts`. */
    'tool.execute.after': createPushHook({ ctx, directory: root }),
  };
}

export const PyatiletkaPlugin: Plugin = async ({ directory, client, worktree }) => {
  const ctx = createCtx({ directory, client: client as Client });
  const root = worktree || directory;

  return {
    tool: createTools(ctx, root),
    ...createHooks(ctx, root),
  } satisfies Hooks;
};

export default PyatiletkaPlugin;

export { bindingOf } from './core/context';
export { bindingFile, clearBinding, readBinding, writeBinding, type Binding } from './core/binding';
export { classify, fmtComment, fmtIssue, priorityOf } from './core/format';
export { buildBody, listTemplates, loadTemplate, splitFrontmatter } from './core/template';
export { findMilestone, inMilestone, milestoneQueue } from './core/milestone';
export { ConfigError, loadConfig, resolveProvider, DEFAULT_PROMOTE_ORDER } from './config';
export { assertProse, lintProse, type ProseMode, type SlopHit } from './prose';
export { parseRemote, resolveRepo, type ResolvedRepo } from './repo';
export { createForge } from './providers';
export type * from './providers/types';
