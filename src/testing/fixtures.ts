import type { ForgeComment, ForgeIssue, ForgeMilestone } from '../providers/types';

/**
 * Fabricas de fixture para teste. Os campos que as tools leem vem preenchidos
 * por padrao, e cada teste sobrescreve so o que importa para a assercao.
 */

export type IssueInput = Partial<ForgeIssue> & { number: number };

export function makeIssue(input: IssueInput): ForgeIssue {
  return {
    id: input.number * 1000,
    title: `issue ${input.number}`,
    state: 'open',
    labels: [],
    milestone: null,
    ...input,
  };
}

export function makeComment(input: Partial<ForgeComment> & { id: number }): ForgeComment {
  return {
    body: `corpo do comentario ${input.id}`,
    user: 'alguem',
    createdAt: '2026-01-02T10:00:00Z',
    ...input,
  };
}

export function makeMilestone(
  input: Partial<ForgeMilestone> & { id: string | number; title: string }
): ForgeMilestone {
  return {
    state: 'open',
    openIssues: 0,
    closedIssues: 0,
    ...input,
  };
}
