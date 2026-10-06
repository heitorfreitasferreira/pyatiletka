import type {
  CreateIssueInput,
  CreatePullInput,
  Forge,
  ForgeActionsConfig,
  ForgeBranch,
  ForgeChecks,
  ForgeComment,
  ForgeCompare,
  ForgeIssue,
  ForgeMilestone,
  ForgeProtection,
  ForgePull,
  ForgePullFile,
  ForgeReview,
  ForgeReviewComment,
  ForgeRun,
  ForgeRunner,
  IssuePatch,
  ListRunsOptions,
  LogsOptions,
  MergeStyle,
} from '../providers/types';

/**
 * `Forge` em memoria, para testar as tools sem rede. Guarda o que foi criado,
 * conta as chamadas e deixa injetar erro por metodo.
 *
 * Nao entra no pacote: `src/index.ts` nao importa este arquivo, entao o
 * `bun build` nao o inclui em `dist`.
 */

export type Call = { method: string; args: unknown[] };

export type FakeState = {
  issues: ForgeIssue[];
  comments: Record<number, ForgeComment[]>;
  deps: Record<number, number[]>;
  milestones: ForgeMilestone[];
  pulls: ForgePull[];
  reviews: Record<number, ForgeReview[]>;
  reviewComments: Record<string, ForgeReviewComment[]>;
  checks: Record<string, ForgeChecks | undefined>;
  files: Record<number, ForgePullFile[]>;
  diff: Record<number, string>;
  runs: ForgeRun[];
  runLogs: Record<number, string>;
  runners: ForgeRunner[];
  actions: ForgeActionsConfig;
  branches: ForgeBranch[];
  protections: ForgeProtection[];
  compare: Record<string, ForgeCompare>;
  repos: string[];
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
  };
}

const key = (base: string, head: string) => `${base}...${head}`;

export class FakeForge implements Forge {
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

  async getIssue(repo: string, n: number): Promise<ForgeIssue> {
    return this.record('getIssue', [repo, n], this.issue(n));
  }

  async listIssues(repo: string, state: 'open' | 'closed' | 'all'): Promise<ForgeIssue[]> {
    return this.record(
      'listIssues',
      [repo, state],
      this.state.issues.filter((i) => state === 'all' || i.state === state)
    );
  }

  async createIssue(repo: string, input: CreateIssueInput): Promise<ForgeIssue> {
    const n = this.nextNumber();
    const created: ForgeIssue = {
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

  async updateIssue(repo: string, n: number, patch: IssuePatch): Promise<ForgeIssue> {
    this.note('updateIssue', [repo, n, patch]);
    const i = this.issue(n);
    if (patch.title !== undefined) i.title = patch.title;
    if (patch.body !== undefined) i.body = patch.body;
    if (patch.state !== undefined) i.state = patch.state;
    if (patch.labels) i.labels = [...patch.labels];
    return i;
  }

  async listComments(repo: string, n: number): Promise<ForgeComment[]> {
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

  async listDependencies(repo: string, n: number): Promise<ForgeIssue[]> {
    const nums = this.state.deps[n] ?? [];
    return this.record(
      'listDependencies',
      [repo, n],
      nums.map((d) => this.state.issues.find((i) => i.number === d)).filter(Boolean) as ForgeIssue[]
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

  async listMilestones(repo: string): Promise<ForgeMilestone[]> {
    return this.record('listMilestones', [repo], this.state.milestones);
  }

  async createMilestone(
    repo: string,
    input: { title: string; description?: string }
  ): Promise<ForgeMilestone> {
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
  ): Promise<ForgeMilestone> {
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
  ): Promise<ForgePull[]> {
    let list = this.state.pulls;
    const state = opts.state ?? 'open';
    if (state !== 'all') {
      list = list.filter((p) => (state === 'open' ? !p.merged : p.merged));
    }
    if (opts.base) list = list.filter((p) => p.baseRef === opts.base);
    if (opts.head) list = list.filter((p) => p.headRef?.includes(opts.head!));
    return this.record('listPulls', [repo, opts], list.slice(0, opts.limit ?? 50));
  }

  async getPull(repo: string, n: number): Promise<ForgePull> {
    const p = this.state.pulls.find((x) => x.number === n);
    if (!p) throw new Error(`PR ${n} nao existe`);
    return this.record('getPull', [repo, n], p);
  }

  async listReviews(repo: string, n: number): Promise<ForgeReview[]> {
    return this.record('listReviews', [repo, n], this.state.reviews[n] ?? []);
  }

  async listReviewComments(
    repo: string,
    n: number,
    reviewId: number
  ): Promise<ForgeReviewComment[]> {
    return this.record(
      'listReviewComments',
      [repo, n, reviewId],
      this.state.reviewComments[`${n}/${reviewId}`] ?? []
    );
  }

  async getChecks(repo: string, sha: string): Promise<ForgeChecks | undefined> {
    return this.record('getChecks', [repo, sha], this.state.checks[sha]);
  }

  async getPullFiles(repo: string, n: number): Promise<ForgePullFile[]> {
    return this.record('getPullFiles', [repo, n], this.state.files[n] ?? []);
  }

  async getPullDiff(repo: string, n: number): Promise<string> {
    return this.record('getPullDiff', [repo, n], this.state.diff[n] ?? '');
  }

  async createPull(repo: string, input: CreatePullInput): Promise<ForgePull> {
    const created: ForgePull = {
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

  async listRuns(repo: string, opts: ListRunsOptions): Promise<ForgeRun[]> {
    let runs = this.state.runs;
    if (opts.branch) runs = runs.filter((r) => r.branch === opts.branch);
    if (opts.event) runs = runs.filter((r) => r.event === opts.event);
    if (opts.active) runs = runs.filter((r) => r.status !== 'completed');
    return this.record('listRuns', [repo, opts], runs.slice(0, opts.limit ?? 10));
  }

  async getRun(repo: string, id: number): Promise<ForgeRun> {
    const r = this.state.runs.find((x) => x.id === id);
    if (!r) throw new Error(`run ${id} nao existe`);
    return this.record('getRun', [repo, id], r);
  }

  async getRunLogs(repo: string, id: number, opts: LogsOptions): Promise<string> {
    return this.record('getRunLogs', [repo, id, opts], this.state.runLogs[id] ?? '');
  }

  async getActionsConfig(repo: string): Promise<ForgeActionsConfig> {
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

  async listRunners(repo: string): Promise<ForgeRunner[]> {
    return this.record('listRunners', [repo], this.state.runners);
  }

  async listBranches(repo: string): Promise<ForgeBranch[]> {
    return this.record('listBranches', [repo], this.state.branches);
  }

  async getBranchProtections(repo: string, branches: string[]): Promise<ForgeProtection[]> {
    return this.record(
      'getBranchProtections',
      [repo, branches],
      this.state.protections.filter((p) => branches.length === 0 || branches.includes(p.branch))
    );
  }

  async compare(repo: string, base: string, head: string): Promise<ForgeCompare> {
    const found = this.state.compare[key(base, head)];
    if (!found) throw new Error(`compare ${base}...${head} sem fixture`);
    return this.record('compare', [repo, base, head], found);
  }

  private issue(n: number): ForgeIssue {
    const found = this.state.issues.find((i) => i.number === n);
    if (!found) throw new Error(`issue ${n} nao existe`);
    return found;
  }

  private nextNumber(): number {
    return Math.max(0, ...this.state.issues.map((i) => i.number)) + 1;
  }
}

export const cmp = (over: Partial<ForgeCompare> = {}): ForgeCompare => ({
  ahead: 0,
  behind: 0,
  status: 'identical',
  commits: [],
  ...over,
});
