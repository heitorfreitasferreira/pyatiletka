import { Plugin } from '@opencode/plugin';
import { tool } from '@opencode-ai/plugin';
import { storageBinding, type BindingStore, type JsonStorage } from '../core/binding';
import { createCtx, type Ctx } from '../core/context';
import { withBindTitle, withoutBindTitle } from '../core/goal';
import { buildSystemHead, compactionNote } from '../core/session';
import { createToolSpecs } from '../tools/factory';
import { createPushHook } from '../tools/push-hook';
import type { ToolGroup, ToolSpec } from '../tools/spec';

/**
 * Adaptador v2. Recebe o contexto do plugin e registra as mesmas specs do v1
 * como tools namespaceadas, hooks de sessao e hook de pos-tool. O estado do
 * vinculo vai para `ctx.storage`.
 */

/** Descricao de cada namespace. O grupo vira prefixo do nome efetivo da tool. */
const NAMESPACES: Record<ToolGroup, string> = {
  auth: 'Credencial e login',
  issue: 'Issues do provider',
  milestone: 'Marcos e epicos',
  pr: 'Pull requests',
  ci: 'Pipelines de CI',
  branch: 'Branches e promocao',
  commit: 'Commits do clone local',
  repo: 'Repositorio e arquivos',
};

function toInputSchema(args: ToolSpec['args']): Record<string, unknown> {
  return tool.schema.toJSONSchema(tool.schema.object(args)) as unknown as Record<string, unknown>;
}

export async function registerTools(ctx: Plugin.Context, specs: ToolSpec[]): Promise<void> {
  const groups = new Map<ToolGroup, ToolSpec[]>();
  for (const spec of specs) {
    const list = groups.get(spec.group) ?? [];
    list.push(spec);
    groups.set(spec.group, list);
  }

  await ctx.tool.transform((editor) => {
    for (const [group, list] of groups) {
      editor.namespace({ name: group, description: NAMESPACES[group] });
      for (const spec of list) {
        editor.add({
          name: spec.name,
          description: spec.description,
          input: toInputSchema(spec.args),
          options: { namespace: group },
          async execute(input, context) {
            const content = await spec.execute(input, {
              sessionID: context.sessionID,
              signal: context.signal,
            });
            return { content };
          },
        });
      }
    }
  });
}

export async function registerHooks(
  ctx: Plugin.Context,
  core: Ctx,
  directory: string,
  binding: BindingStore
): Promise<void> {
  await ctx.session.hook('context', async (event) => {
    const b = await binding.read(event.sessionID);
    if (!b) {
      event.system.push({
        type: 'text',
        text: 'Ao vincular uma issue com `issue_bind`, confirme antes com a tool `question`: a partir do sim, a sessao passa a ser daquela issue e o `/goal` sera definido para ela.',
      });
      return;
    }
    event.system.push({ type: 'text', text: await buildSystemHead(core, b) });
    if (b.goal) {
      event.system.push({
        type: 'text',
        text: 'Esta sessao esta no `/goal` de resolver a issue vinculada. Continue ate cumprir o criterio de aceite e fechar a issue.',
      });
    }
  });

  await ctx.session.hook('compaction', async (event) => {
    const b = await binding.read(event.sessionID);
    if (!b) return;
    event.system.push({ type: 'text', text: compactionNote(b, core.toolPrefix) });
  });

  const push = createPushHook({ ctx: core, directory });
  await ctx.tool.hook('execute.after', async (event) => {
    if (event.status !== 'completed') return;
    const out = { output: typeof event.result.content === 'string' ? event.result.content : '' };
    await push({ tool: event.tool, args: event.input }, out);
    const notice = await goalNotice(ctx, binding, event).catch(() => undefined);
    if (notice) out.output = [out.output, notice].filter(Boolean).join('\n\n');
    if (out.output) event.result = { ...event.result, content: out.output };
  });
}

const BIND_TOOLS = new Set(['issue_bind', 'issue.bind']);
const UNBIND_TOOLS = new Set(['issue_unbind', 'issue.unbind']);

/**
 * Depois do bind, define o `/goal` da sessao e acrescenta a issue ao titulo.
 * Depois do unbind, limpa o goal e tira o sufixo. Falha aqui nao derruba o
 * resultado da tool.
 */
async function goalNotice(
  ctx: Plugin.Context,
  binding: BindingStore,
  event: { tool: string; sessionID?: string }
): Promise<string | undefined> {
  const sessionID = event.sessionID;
  if (!sessionID) return undefined;

  if (UNBIND_TOOLS.has(event.tool)) {
    await clearGoal(ctx, sessionID);
    return undefined;
  }
  if (!BIND_TOOLS.has(event.tool)) return undefined;

  const b = await binding.read(sessionID);
  const issue = b?.issue;
  if (!b || !issue) return undefined;

  let session;
  try {
    session = await ctx.session.get({ sessionID });
  } catch {
    return undefined;
  }
  if (session.parentID) return undefined;

  const current = session.title ?? '';
  const base = isFallbackTitle(current) ? (b.issueTitle ?? `Resolver ${b.repo}#${issue}`) : current;
  const title = withBindTitle(base, b.repo, issue);
  if (title !== session.title) {
    await ctx.session.update({ sessionID, title }).catch(() => {});
  }

  const objective = b.goal ?? `Resolver ${b.repo}#${issue}`;
  try {
    await ctx.session.command({
      sessionID,
      name: 'goal',
      text: objective,
      delivery: 'queue',
    });
  } catch {
    return undefined;
  }
  return 'O /goal desta sessao foi definido para resolver esta issue.';
}

async function clearGoal(ctx: Plugin.Context, sessionID: string): Promise<void> {
  let session;
  try {
    session = await ctx.session.get({ sessionID });
  } catch {
    return;
  }
  if (session.parentID) return;

  const current = session.title ?? '';
  const title = withoutBindTitle(current);
  if (title && title !== current) {
    await ctx.session.update({ sessionID, title }).catch(() => {});
  }
  await ctx.session.command({ sessionID, name: 'goal', text: 'clear' }).catch(() => {});
}

function isFallbackTitle(title: string): boolean {
  if (!title.trim()) return true;
  return /^(new session|untitled|nova sessao|sessao nova)$/i.test(title.trim());
}

export async function setupV2(ctx: Plugin.Context): Promise<void> {
  const directory = ctx.location.directory;
  const core = createCtx({
    directory,
    options: ctx.options as Record<string, unknown>,
    goal: true,
  });
  const binding = storageBinding(ctx.storage as unknown as JsonStorage);
  await registerTools(ctx, createToolSpecs({ ctx: core, directory, binding }));
  await registerHooks(ctx, core, directory, binding);
}
