import { Plugin } from '@opencode/plugin';
import { tool } from '@opencode-ai/plugin';
import { storageBinding, type BindingStore, type JsonStorage } from '../core/binding';
import { createCtx, type Ctx } from '../core/context';
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
  issue: 'Issues do provider',
  milestone: 'Marcos e epicos',
  pr: 'Pull requests',
  ci: 'Pipelines de CI',
  branch: 'Branches e promocao',
  commit: 'Commits do clone local',
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
    if (!b) return;
    event.system.push({ type: 'text', text: await buildSystemHead(core, b) });
  });

  await ctx.session.hook('compaction', async (event) => {
    const b = await binding.read(event.sessionID);
    if (!b) return;
    event.system.push({ type: 'text', text: compactionNote(b) });
  });

  const push = createPushHook({ ctx: core, directory });
  await ctx.tool.hook('execute.after', async (event) => {
    if (event.status !== 'completed') return;
    const out = { output: typeof event.result.content === 'string' ? event.result.content : '' };
    await push({ tool: event.tool, args: event.input }, out);
    if (out.output) event.result = { ...event.result, content: out.output };
  });
}

export async function setupV2(ctx: Plugin.Context): Promise<void> {
  const directory = ctx.location.directory;
  const core = createCtx({ directory, options: ctx.options as Record<string, unknown> });
  const binding = storageBinding(ctx.storage as unknown as JsonStorage);
  await registerTools(ctx, createToolSpecs({ ctx: core, directory, binding }));
  await registerHooks(ctx, core, directory, binding);
}
