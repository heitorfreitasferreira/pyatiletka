import type { BindingStore } from '../core/binding';
import type { Ctx } from '../core/context';
import { branchTools } from './branches';
import { issueTools } from './issues';
import { pipelineTools } from './pipeline';
import { pullTools } from './pulls';
import type { ToolSpec } from './spec';

/**
 * Composicao das tools em formato neutro. O v1 e o v2 montam a partir daqui,
 * entao o conjunto de tools tem uma fonte so.
 */

export type ToolSpecsInput = {
  ctx: Ctx;
  directory: string;
  /** Store do vinculo. Sem ele, as tools de issue usam arquivo. */
  binding?: BindingStore;
};

export function createToolSpecs({ ctx, directory, binding }: ToolSpecsInput): ToolSpec[] {
  return [
    ...issueTools({ ctx, directory, binding }),
    ...pullTools({ ctx }),
    ...pipelineTools({ ctx, defaultBranch: ctx.config.defaultBranch ?? '' }),
    ...branchTools({ ctx, directory, promoteOrder: ctx.config.promoteOrder }),
  ];
}
