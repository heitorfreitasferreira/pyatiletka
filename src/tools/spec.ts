import type { ToolDefinition, ToolResult } from '@opencode-ai/plugin';
import type { z } from 'zod';

/**
 * Definicao neutra de tool, compartilhada entre o adapter v1 e o v2.
 *
 * O grupo vira namespace no v2 e prefixo de nome no v1, entao o nome efetivo
 * (`grupo_nome`) e o mesmo nas duas versoes. O `args` fica em Zod porque e o
 * que os dois lados ja usam: o v1 passa direto para `tool()`, o v2 converte
 * para JSON Schema.
 */

export type ToolGroup = 'auth' | 'issue' | 'milestone' | 'pr' | 'ci' | 'branch' | 'commit';

export type ToolExec = {
  sessionID: string;
  signal?: AbortSignal;
};

export type ToolSpec = {
  group: ToolGroup;
  name: string;
  description: string;
  args: z.ZodRawShape;
  execute: (args: unknown, exec: ToolExec) => Promise<string>;
};

/** Maior prefixo primeiro, para `commit_` nao casar como outra coisa. */
const GROUPS: ToolGroup[] = ['auth', 'milestone', 'branch', 'commit', 'issue', 'ci', 'pr'];

function split(key: string): { group: ToolGroup; name: string } {
  for (const group of GROUPS) {
    if (key.startsWith(`${group}_`)) return { group, name: key.slice(group.length + 1) };
  }
  throw new Error(`tool "${key}" sem prefixo de grupo conhecido`);
}

/** Converte o mapa `nome -> tool()` no formato neutro, inferindo o grupo pelo prefixo. */
export function toolSpecs(defs: Record<string, ToolDefinition>): ToolSpec[] {
  return Object.entries(defs).map(([key, def]) => {
    const { group, name } = split(key);
    return {
      group,
      name,
      description: def.description,
      args: def.args as z.ZodRawShape,
      execute: (args, exec) =>
        def.execute(args as never, exec as never) as Promise<ToolResult> as Promise<string>,
    };
  });
}

/** Nome efetivo (`grupo_nome`), identico ao v1. */
export function toolName(spec: ToolSpec): string {
  return `${spec.group}_${spec.name}`;
}
