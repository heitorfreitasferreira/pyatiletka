import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { toolName, type ToolSpec } from '../tools/spec';

/** Monta o mapa `nome -> tool()` do v1 a partir das specs neutras. */
export function toV1Tools(specs: ToolSpec[]): Record<string, ToolDefinition> {
  const out: Record<string, ToolDefinition> = {};
  for (const spec of specs) {
    out[toolName(spec)] = tool({
      description: spec.description,
      args: spec.args,
      execute: (args, ctx) => spec.execute(args, { sessionID: ctx.sessionID, signal: ctx.abort }),
    });
  }
  return out;
}
