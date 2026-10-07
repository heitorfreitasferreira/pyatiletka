import type { Config } from '../config';
import type { ProseMode } from '../prose';
import type { IssueComment, Issue, Milestone } from '../providers/types';

/**
 * Fabricas de fixture para teste. Os campos que as tools leem vem preenchidos
 * por padrao, e cada teste sobrescreve so o que importa para a assercao.
 */

export type IssueInput = Partial<Issue> & { number: number };

export function makeIssue(input: IssueInput): Issue {
  return {
    id: input.number * 1000,
    title: `issue ${input.number}`,
    state: 'open',
    labels: [],
    milestone: null,
    ...input,
  };
}

export function makeComment(input: Partial<IssueComment> & { id: number }): IssueComment {
  return {
    body: `corpo do comentario ${input.id}`,
    user: 'alguem',
    createdAt: '2026-01-02T10:00:00Z',
    ...input,
  };
}

export function makeMilestone(
  input: Partial<Milestone> & { id: string | number; title: string }
): Milestone {
  return {
    state: 'open',
    openIssues: 0,
    closedIssues: 0,
    ...input,
  };
}

export const REPO = 'org/repo';

/** Config de teste. Sobreposicao parcial, o resto tem valor util. */
export function makeConfig(over: Partial<Config> = {}): Config {
  return {
    provider: 'gitea',
    baseUrl: 'https://git.test',
    host: 'git.test',
    token: 'token-de-teste',
    authSource: 'env',
    org: 'org',
    defaultRepo: REPO,
    login: 'ana',
    defaultBranch: 'main',
    promoteOrder: ['staging', 'production'],
    prose: 'block' as ProseMode,
    ...over,
  };
}
