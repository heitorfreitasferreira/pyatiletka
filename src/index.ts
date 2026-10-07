import type { Hooks, Plugin } from '@opencode-ai/plugin';
import { Plugin as PluginV2 } from '@opencode/plugin';
import { toV1Tools } from './adapters/v1';
import { setupV2 } from './adapters/v2';
import { readBinding } from './core/binding';
import { createCtx, type Client, type Ctx } from './core/context';
import { buildSystemHead, compactionNote } from './core/session';
import { createToolSpecs } from './tools/factory';
import { createPushHook } from './tools/push-hook';

/**
 * pyatiletka: fluxo de issues, marcos, PRs e CI para agentes, em Gitea e
 * GitHub.
 *
 * Suporta opencode v1 e v2 pelo mesmo pacote. O v2 chama `setup` (default
 * export objeto), o v1 chama `server` (entrypoint objeto, opencode >= 1.18.29).
 * A config vem do ambiente e, no v2, tambem de `ctx.options`.
 *
 * A credencial vem do ambiente, de um `.env`, de um login ja feito no `gh`/`tea`
 * ou de um login manual. Sem nenhuma, a carga nao falha: a primeira chamada de
 * rede explica o que falta e `auth_login` diz o comando.
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
 * Monta o contexto da sessao e o conjunto de tools v1. Os `src/tools/*` sao
 * grupos puros que devolvem specs neutras; o adapter v1 vira `tool()`.
 */
export function createTools(ctx: Ctx, directory: string) {
  return toV1Tools(createToolSpecs({ ctx, directory }));
}

/**
 * Os tres hooks v1 que dependem de sessao. Fica separado da carga do plugin
 * para o teste injetar um `FakeGitHost` e nao chamar a rede.
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
      output.system.push(await buildSystemHead(ctx, b));
    },

    /** Preserva o vinculo atraves de compaction. */
    'experimental.session.compacting': async (input, output) => {
      const b = readBinding(root, input.sessionID);
      if (!b) return;
      output.context.push(compactionNote(b));
    },

    /** Push espera o CI antes de devolver. Ver `src/tools/push-hook.ts`. */
    'tool.execute.after': createPushHook({ ctx, directory: root }),
  };
}

/** Entrypoint v1: funcao que recebe o input do host e devolve tools e hooks. */
export const PyatiletkaPlugin: Plugin = async ({ directory, client, worktree }) => {
  const ctx = createCtx({ directory, client: client as Client });
  const root = worktree || directory;

  return {
    tool: createTools(ctx, root),
    ...createHooks(ctx, root),
  } satisfies Hooks;
};

/** Entrypoint v2: `Plugin.define` com setup que registra tools, hooks e storage. */
export const PyatiletkaV2 = PluginV2.define({
  id: 'pyatiletka',
  async setup(ctx) {
    await setupV2(ctx);
  },
});

/**
 * O default export carrega os dois. O v2 detecta `setup`; o v1 (>= 1.18.29)
 * detecta `server` e ignora o resto.
 */
export default {
  ...PyatiletkaV2,
  server: PyatiletkaPlugin,
};

export { bindingOf } from './core/context';
export {
  bindingFile,
  clearBinding,
  fileBinding,
  readBinding,
  storageBinding,
  writeBinding,
  type Binding,
  type BindingStore,
} from './core/binding';
export { buildSystemHead, compactionNote } from './core/session';
export { classify, fmtComment, fmtIssue, priorityOf } from './core/format';
export { buildBody, listTemplates, loadTemplate, splitFrontmatter } from './core/template';
export { findMilestone, inMilestone, milestoneQueue } from './core/milestone';
export { ConfigError, loadConfig, resolveProvider, DEFAULT_PROMOTE_ORDER } from './config';
export { assertProse, lintProse, type ProseMode, type SlopHit } from './prose';
export { parseRemote, resolveRepo, type ResolvedRepo } from './repo';
export { createGitHost } from './providers';
export { createToolSpecs, type ToolSpecsInput } from './tools/factory';
export { toolName, type ToolGroup, type ToolSpec } from './tools/spec';
export { toV1Tools } from './adapters/v1';
export { setupV2 } from './adapters/v2';
export { VERSION } from './version';
export type * from './providers/types';
