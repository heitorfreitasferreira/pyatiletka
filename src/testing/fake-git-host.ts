import type {
  CreateIssueInput,
  CreatePullInput,
  GitHost,
  ActionsConfig,
  Branch,
  Checks,
  IssueComment,
  Compare,
  Issue,
  Milestone,
  Protection,
  Pull,
  PullFile,
  RepoInfo,
  Review,
  ReviewComment,
  Run,
  Runner,
  IssuePatch,
  ListRunsOptions,
  LogsOptions,
  MergeStyle,
  Viewer,
} from '../providers/types';

/**
 * `GitHost` em memoria, para testar as tools sem rede. Guarda o que foi criado,
 * conta as chamadas e deixa injetar erro por metodo.
 *
 * Nao entra no pacote: `src/index.ts` nao importa este arquivo, entao o
 * `bun build` nao o inclui em `dist`.
 */

export type Call = { method: string; args: unknown[] };

export type FakeState = {
  issues: Issue[];
  comments: Record<number, IssueComment[]>;
  deps: Record<number, number[]>;
  milestones: Milestone[];
  pulls: Pull[];
  reviews: Record<number, Review[]>;
  reviewComments: Record<string, ReviewComment[]>;
  checks: Record<string, Checks | undefined>;
  files: Record<number, PullFile[]>;
  diff: Record<number, string>;
  runs: Run[];
  runLogs: Record<number, string>;
  runners: Runner[];
  actions: ActionsConfig;
  branches: Branch[];
  protections: Protection[];
  compare: Record<string, Compare>;
  repos: string[];
  viewer: string;
  defaultBranch?: string;
};

function emptyState(): FakeState {
  return {
    issues: [],
    comments: {},
    deps: {},
    milestones: [],
    pulls: [],
    reviews: {},
    reviewComments: {},
    checks: {},
    files: {},
    diff: {},
    runs: [],
    runLogs: {},
    runners: [],
    actions: { variables: [], secrets: [], workflows: [] },
    branches: [],
    protections: [],
    compare: {},
    repos: [],
    viewer: 'eu',
  };
}

const key = (base: string, head: string) => `${base}...${head}`;

export class FakeGitHost implements GitHost {
  readonly provider = 'gitea' as const;
  readonly state: FakeState;
  /** Toda chamada feita, na ordem. Serve para as assercoes. */
  readonly calls: Call[] = [];
  /** Metodo -> erro para a proxima chamada. */
  readonly fail = new Map<string, Error>();

  constructor(state: Partial<FakeState> = {}) {
    this.state = { ...emptyState(), ...state };
  }

  /** Reseta as assercoes sem tocar no estado. */
  resetCalls(): void {
    this.calls.length = 0;
    this.fail.clear();
  }

  called(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Registra a chamada e consome o erro injetado, se houver. */
  private note(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    const err = this.fail.get(method);
    if (err) {
      this.fail.delete(method);
      throw err;
    }
  }

  private record<T>(method: string, args: unknown[], value: T): T {
    this.note(method, args);
    return value;
  }

  async listRepos(org: string): Promise<string[]> {
    return this.record('listRepos', [org], this.state.repos);
  }

  async getViewer(): Promise<Viewer> {
    return this.record('getViewer', [], { login: this.state.viewer });
  }

  async getRepo(repo: string): Promise<RepoInfo> {
    return this.record('getRepo', [repo], { defaultBranch: this.state.defaultBranch });
  }

  async getIssue(repo: string, n: number): Promise<Issue> {
    return this.record('getIssue', [repo, n], this.issue(n));
  }

  async listIssues(repo: string, state: 'open' | 'closed' | 'all'): Promise<Issue[]> {
    return this.record(
      'listIssues',
      [repo, state],
      this.state.issues.filter((i) => state === 'all' || i.state === state)
    );
  }

  async createIssue(repo: string, input: CreateIssueInput): Promise<Issue> {
    const n = this.nextNumber();
    const created: Issue = {
      id: n * 1000,
      number: n,
      title: input.title,
      state: 'open',
      body: input.body,
      labels: [...input.labels],
      milestone: null,
    };
    this.record('createIssue', [repo, input], created);
    this.state.issues.push(created);
    return created;
  }

  async updateIssue(repo: string, n: number, patch: IssuePatch): Promise<Issue> {
    this.note('updateIssue', [repo, n, patch]);
    const i = this.issue(n);
    if (patch.title !== undefined) i.title = patch.title;
    if (patch.body !== undefined) i.body = patch.body;
    if (patch.state !== undefined) i.state = patch.state;
    if (patch.labels) i.labels = [...patch.labels];
    return i;
  }

  async listComments(repo: string, n: number): Promise<IssueComment[]> {
    return this.record('listComments', [repo, n], this.state.comments[n] ?? []);
  }

  async createComment(repo: string, n: number, body: string): Promise<void> {
    const id = (this.state.comments[n]?.length ?? 0) + 1;
    this.note('createComment', [repo, n, body]);
    this.state.comments[n] = [
      ...(this.state.comments[n] ?? []),
      { id, body, user: 'alguem', createdAt: '2026-01-01T00:00:00Z' },
    ];
  }

  async updateComment(repo: string, commentId: number, body: string): Promise<void> {
    this.note('updateComment', [repo, commentId, body]);
    for (const list of Object.values(this.state.comments)) {
      const hit = list.find((c) => c.id === commentId);
      if (hit) hit.body = body;
    }
  }

  async listDependencies(repo: string, n: number): Promise<Issue[]> {
    const nums = this.state.deps[n] ?? [];
    return this.record(
      'listDependencies',
      [repo, n],
      nums.map((d) => this.state.issues.find((i) => i.number === d)).filter(Boolean) as Issue[]
    );
  }

  async addDependencies(repo: string, n: number, blockers: number[]): Promise<void> {
    this.note('addDependencies', [repo, n, blockers]);
    const cur = this.state.deps[n] ?? [];
    this.state.deps[n] = [...new Set([...cur, ...blockers.filter((b) => b !== n)])];
  }

  async removeDependency(repo: string, n: number, blocker: number): Promise<void> {
    this.note('removeDependency', [repo, n, blocker]);
    this.state.deps[n] = (this.state.deps[n] ?? []).filter((d) => d !== blocker);
  }

  async listMilestones(repo: string): Promise<Milestone[]> {
    return this.record('listMilestones', [repo], this.state.milestones);
  }

  async createMilestone(
    repo: string,
    input: { title: string; description?: string }
  ): Promise<Milestone> {
    const created = {
      id: this.state.milestones.length + 1,
      title: input.title,
      description: input.description,
      state: 'open',
      openIssues: 0,
      closedIssues: 0,
    };
    this.record('createMilestone', [repo, input], created);
    this.state.milestones.push(created);
    return created;
  }

  async updateMilestone(
    repo: string,
    id: string | number,
    patch: { title?: string; description?: string; state?: 'open' | 'closed' }
  ): Promise<Milestone> {
    this.note('updateMilestone', [repo, id, patch]);
    const m = this.state.milestones.find((x) => String(x.id) === String(id));
    if (!m) throw new Error(`marco ${id} nao existe`);
    Object.assign(m, patch);
    return m;
  }

  async setIssueMilestone(repo: string, n: number, milestoneId: string | number): Promise<void> {
    this.note('setIssueMilestone', [repo, n, milestoneId]);
    const ms = this.state.milestones.find((m) => String(m.id) === String(milestoneId));
    this.issue(n).milestone = ms ? { id: ms.id, title: ms.title } : null;
  }

  async listPulls(
    repo: string,
    opts: { state?: 'open' | 'closed' | 'all'; base?: string; head?: string; limit?: number }
  ): Promise<Pull[]> {
    let list = this.state.pulls;
    const state = opts.state ?? 'open';
    if (state !== 'all') {
      list = list.filter((p) => (state === 'open' ? !p.merged : p.merged));
    }
    if (opts.base) list = list.filter((p) => p.baseRef === opts.base);
    if (opts.head) list = list.filter((p) => p.headRef?.includes(opts.head!));
    return this.record('listPulls', [repo, opts], list.slice(0, opts.limit ?? 50));
  }

  async getPull(repo: string, n: number): Promise<Pull> {
    const p = this.state.pulls.find((x) => x.number === n);
    if (!p) throw new Error(`PR ${n} nao existe`);
    return this.record('getPull', [repo, n], p);
  }

  async listReviews(repo: string, n: number): Promise<Review[]> {
    return this.record('listReviews', [repo, n], this.state.reviews[n] ?? []);
  }

  async listReviewComments(repo: string, n: number, reviewId: number): Promise<ReviewComment[]> {
    return this.record(
      'listReviewComments',
      [repo, n, reviewId],
      this.state.reviewComments[`${n}/${reviewId}`] ?? []
    );
  }

  async getChecks(repo: string, sha: string): Promise<Checks | undefined> {
    return this.record('getChecks', [repo, sha], this.state.checks[sha]);
  }

  async getPullFiles(repo: string, n: number): Promise<PullFile[]> {
    return this.record('getPullFiles', [repo, n], this.state.files[n] ?? []);
  }

  async getPullDiff(repo: string, n: number): Promise<string> {
    return this.record('getPullDiff', [repo, n], this.state.diff[n] ?? '');
  }

  async createPull(repo: string, input: CreatePullInput): Promise<Pull> {
    const created: Pull = {
      number: this.state.pulls.length + 1,
      title: input.title,
      state: 'open',
      headRef: input.head,
      baseRef: input.base,
      body: input.body,
      draft: input.draft,
      labels: [],
    };
    this.record('createPull', [repo, input], created);
    this.state.pulls.push(created);
    return created;
  }

  async mergePull(
    repo: string,
    n: number,
    style: MergeStyle,
    opts: { deleteBranch?: boolean } = {}
  ): Promise<string> {
    this.note('mergePull', [repo, n, style, opts]);
    const p = this.state.pulls.find((x) => x.number === n);
    if (p) {
      p.merged = true;
      p.state = 'closed';
    }
    return `merged (${style})`;
  }

  async listRuns(repo: string, opts: ListRunsOptions): Promise<Run[]> {
    let runs = this.state.runs;
    if (opts.branch) runs = runs.filter((r) => r.branch === opts.branch);
    if (opts.event) runs = runs.filter((r) => r.event === opts.event);
    if (opts.active) runs = runs.filter((r) => r.status !== 'completed');
    return this.record('listRuns', [repo, opts], runs.slice(0, opts.limit ?? 10));
  }

  async getRun(repo: string, id: number): Promise<Run> {
    const r = this.state.runs.find((x) => x.id === id);
    if (!r) throw new Error(`run ${id} nao existe`);
    return this.record('getRun', [repo, id], r);
  }

  async getRunLogs(repo: string, id: number, opts: LogsOptions): Promise<string> {
    return this.record('getRunLogs', [repo, id, opts], this.state.runLogs[id] ?? '');
  }

  async getActionsConfig(repo: string): Promise<ActionsConfig> {
    return this.record('getActionsConfig', [repo], this.state.actions);
  }

  async dispatchWorkflow(
    repo: string,
    workflow: string,
    ref: string,
    inputs?: Record<string, string>
  ): Promise<void> {
    this.note('dispatchWorkflow', [repo, workflow, ref, inputs]);
  }

  async listRunners(repo: string): Promise<Runner[]> {
    return this.record('listRunners', [repo], this.state.runners);
  }

  async listBranches(repo: string): Promise<Branch[]> {
    return this.record('listBranches', [repo], this.state.branches);
  }

  async getBranchProtections(repo: string, branches: string[]): Promise<Protection[]> {
    return this.record(
      'getBranchProtections',
      [repo, branches],
      this.state.protections.filter((p) => branches.length === 0 || branches.includes(p.branch))
    );
  }

  async compare(repo: string, base: string, head: string): Promise<Compare> {
    const found = this.state.compare[key(base, head)];
    if (!found) throw new Error(`compare ${base}...${head} sem fixture`);
    return this.record('compare', [repo, base, head], found);
  }

  private issue(n: number): Issue {
    const found = this.state.issues.find((i) => i.number === n);
    if (!found) throw new Error(`issue ${n} nao existe`);
    return found;
  }

  private nextNumber(): number {
    return Math.max(0, ...this.state.issues.map((i) => i.number)) + 1;
  }
}

export const cmp = (over: Partial<Compare> = {}): Compare => ({
  ahead: 0,
  behind: 0,
  status: 'identical',
  commits: [],
  ...over,
});
