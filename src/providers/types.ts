import type { ProviderName } from '../config';

/**
 * Tipos normalizados entre Gitea e GitHub. As tools falam so com isto.
 * O que diverge fica no provider: corpo de dependencia, id vs number de
 * milestone, nomes vs IDs de label, paginacao e formato de log.
 */

export type Issue = {
  number: number;
  /** Id interno. GitHub exige para criar dependencia. */
  id: number;
  title: string;
  state: string;
  body?: string;
  htmlUrl?: string;
  user?: string;
  assignees?: string[];
  labels: string[];
  milestone?: { id: string | number; title: string } | null;
  comments?: number;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
};

export type Milestone = {
  /** Gitea: id numerico. GitHub: number. Tratado como string na resolucao. */
  id: string | number;
  title: string;
  description?: string;
  state: string;
  openIssues: number;
  closedIssues: number;
  dueOn?: string | null;
};

export type IssueComment = {
  id: number;
  body?: string;
  user?: string;
  createdAt?: string;
  updatedAt?: string;
  htmlUrl?: string;
};

export type Review = {
  id: number;
  state?: string;
  body?: string;
  user?: string;
  submittedAt?: string;
  commentsCount?: number;
  htmlUrl?: string;
};

export type ReviewComment = {
  id: number;
  body?: string;
  path?: string;
  position?: number;
  user?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Pull = {
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  mergeable?: boolean;
  htmlUrl?: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string | null;
  user?: string;
  headRef?: string;
  headSha?: string;
  baseRef?: string;
  labels: string[];
  milestone?: { id: string | number; title: string } | null;
  comments?: number;
};

export type Check = {
  context: string;
  status: string;
  description?: string;
  url?: string;
};

export type Checks = {
  overall: string;
  statuses: Check[];
};

export type Run = {
  id: number;
  status: string;
  conclusion?: string | null;
  branch?: string;
  sha?: string;
  title?: string;
  path?: string;
  event?: string;
  url?: string;
  runNumber?: number;
  startedAt?: string;
  completedAt?: string;
};

export type Runner = {
  id: number;
  name: string;
  status: string;
  busy: boolean;
  labels?: string[];
};

export type Workflow = {
  id: string;
  name: string;
  path?: string;
  state?: string;
};

export type ActionsConfig = {
  variables: { name: string; value?: string; lines?: number; chars?: number }[];
  secrets: string[];
  workflows: Workflow[];
};

export type Branch = {
  name: string;
  protected: boolean;
};

export type Protection = {
  branch: string;
  summary: string;
  raw?: unknown;
};

export type Compare = {
  ahead: number;
  behind: number;
  status: 'behind' | 'ahead' | 'diverged' | 'identical';
  commits: { sha: string; message: string }[];
};

export type CreateIssueInput = {
  title: string;
  body: string;
  labels: string[];
  milestone?: string;
};

export type IssuePatch = {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  stateReason?: 'completed' | 'not_planned';
  labels?: string[];
};

export type CreatePullInput = {
  head: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
};

export type MergeStyle = 'merge' | 'squash' | 'rebase' | 'fast-forward-only';

export type PullFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

export type ListRunsOptions = {
  branch?: string;
  event?: string;
  active?: boolean;
  limit?: number;
};

export type LogsOptions = {
  /** Nome do job (filtro por cabecalho). */
  step?: string;
  /** Regex por linha. */
  grep?: string;
  /** Ultimas N linhas. */
  tail?: number;
  /** Log completo em vez de so linhas de erro. */
  full?: boolean;
};

export interface GitHost {
  readonly provider: ProviderName;

  // -- repo ---------------------------------------------------------------
  listRepos(org: string): Promise<string[]>;

  // -- issues -------------------------------------------------------------
  getIssue(repo: string, n: number): Promise<Issue>;
  listIssues(repo: string, state: 'open' | 'closed' | 'all'): Promise<Issue[]>;
  createIssue(repo: string, input: CreateIssueInput): Promise<Issue>;
  updateIssue(repo: string, n: number, patch: IssuePatch): Promise<Issue>;

  // -- comentarios ---------------------------------------------------------
  listComments(repo: string, n: number): Promise<IssueComment[]>;
  createComment(repo: string, n: number, body: string): Promise<void>;
  updateComment(repo: string, commentId: number, body: string): Promise<void>;

  // -- dependencias nativas -------------------------------------------------
  listDependencies(repo: string, n: number): Promise<Issue[]>;
  addDependencies(repo: string, n: number, blockers: number[]): Promise<void>;
  removeDependency(repo: string, n: number, blocker: number): Promise<void>;

  // -- milestones -----------------------------------------------------------
  listMilestones(repo: string): Promise<Milestone[]>;
  createMilestone(repo: string, input: { title: string; description?: string }): Promise<Milestone>;
  updateMilestone(
    repo: string,
    id: string | number,
    patch: { title?: string; description?: string; state?: 'open' | 'closed' }
  ): Promise<Milestone>;
  setIssueMilestone(repo: string, n: number, milestoneId: string | number): Promise<void>;

  // -- pulls ---------------------------------------------------------------
  listPulls(
    repo: string,
    opts: { state?: 'open' | 'closed' | 'all'; base?: string; head?: string; limit?: number }
  ): Promise<Pull[]>;
  getPull(repo: string, n: number): Promise<Pull>;
  listReviews(repo: string, n: number): Promise<Review[]>;
  listReviewComments(repo: string, n: number, reviewId: number): Promise<ReviewComment[]>;
  getChecks(repo: string, sha: string): Promise<Checks | undefined>;
  getPullFiles(repo: string, n: number): Promise<PullFile[]>;
  /** Diff cru no formato unificado. */
  getPullDiff(repo: string, n: number): Promise<string>;
  createPull(repo: string, input: CreatePullInput): Promise<Pull>;
  mergePull(
    repo: string,
    n: number,
    style: MergeStyle,
    opts?: { deleteBranch?: boolean }
  ): Promise<string>;

  // -- pipeline ------------------------------------------------------------
  listRuns(repo: string, opts: ListRunsOptions): Promise<Run[]>;
  getRun(repo: string, id: number): Promise<Run>;
  getRunLogs(repo: string, id: number, opts: LogsOptions): Promise<string>;
  getActionsConfig(repo: string): Promise<ActionsConfig>;
  dispatchWorkflow(
    repo: string,
    workflow: string,
    ref: string,
    inputs?: Record<string, string>
  ): Promise<void>;
  listRunners(repo: string): Promise<Runner[]>;

  // -- branches ------------------------------------------------------------
  listBranches(repo: string): Promise<Branch[]>;
  getBranchProtections(repo: string, branches: string[]): Promise<Protection[]>;
  compare(repo: string, base: string, head: string): Promise<Compare>;
}
