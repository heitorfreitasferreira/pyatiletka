import { unzipSync } from 'fflate';
import type { Config } from '../config';
import { shapeLog } from '../core/logs';
import { ForgeError, Http } from './http';
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
  ForgeReview,
  ForgeReviewComment,
  ForgeRun,
  ForgeRunner,
  IssuePatch,
  ListRunsOptions,
  LogsOptions,
  MergeStyle,
} from './types';

/**
 * Provider GitHub. Tudo por REST, inclusive log de run (o endpoint devolve um
 * zip e o `fflate` descomprime, sem exigir binario externo). Dependencia
 * nativa, milestones e comentarios de PR tem o mesmo conceito do Gitea, com
 * corpos e identificadores diferentes tratados aqui.
 */

type GhIssue = {
  number: number;
  id: number;
  title: string;
  state: string;
  state_reason?: string | null;
  body?: string | null;
  html_url?: string;
  user?: { login?: string } | null;
  assignees?: { login?: string }[] | null;
  labels?: ({ name?: string } | string)[];
  milestone?: { number: number; title: string } | null;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: unknown;
};

type GhMilestone = {
  number: number;
  title: string;
  description?: string | null;
  state: string;
  open_issues: number;
  closed_issues: number;
  due_on?: string | null;
};

type GhComment = {
  id: number;
  body?: string | null;
  user?: { login?: string } | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
};

type GhPull = {
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  mergeable?: boolean | null;
  html_url?: string;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
  merged_at?: string | null;
  user?: { login?: string } | null;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  labels?: ({ name?: string } | string)[];
  milestone?: { number: number; title: string } | null;
  comments?: number;
};

type GhRun = {
  id: number;
  status: string;
  conclusion?: string | null;
  head_branch?: string | null;
  head_sha?: string;
  display_title?: string;
  name?: string;
  path?: string;
  event?: string;
  html_url?: string;
  run_number?: number;
  run_started_at?: string;
  created_at?: string;
  updated_at?: string;
};

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

const issuePath = (repo: string, n?: number | string) =>
  `/repos/${repo}/issues${n === undefined ? '' : `/${String(n).replace(/^#/, '')}`}`;

const pullPath = (repo: string, n?: number | string) =>
  `/repos/${repo}/pulls${n === undefined ? '' : `/${String(n).replace(/^#/, '')}`}`;

export class GitHubForge implements Forge {
  readonly provider = 'github' as const;
  private http: Http;

  constructor(private config: Config) {
    this.http = new Http('github', config.baseUrl, config.token);
  }

  private labelNames(labels?: ({ name?: string } | string)[]): string[] {
    return (labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);
  }

  private mapIssue(i: GhIssue): ForgeIssue {
    return {
      number: i.number,
      id: i.id,
      title: i.title,
      state: i.state,
      body: i.body ?? undefined,
      htmlUrl: i.html_url,
      user: i.user?.login,
      assignees: (i.assignees ?? []).map((a) => a.login).filter((x): x is string => Boolean(x)),
      labels: this.labelNames(i.labels),
      milestone: i.milestone ? { id: i.milestone.number, title: i.milestone.title } : null,
      comments: i.comments,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      closedAt: i.closed_at,
    };
  }

  private mapMilestone(m: GhMilestone): ForgeMilestone {
    return {
      id: m.number,
      title: m.title,
      description: m.description ?? undefined,
      state: m.state,
      openIssues: m.open_issues,
      closedIssues: m.closed_issues,
      dueOn: m.due_on,
    };
  }

  private mapComment(c: GhComment): ForgeComment {
    return {
      id: c.id,
      body: c.body ?? undefined,
      user: c.user?.login,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      htmlUrl: c.html_url,
    };
  }

  private mapPull(p: GhPull): ForgePull {
    return {
      number: p.number,
      title: p.title,
      state: p.state,
      merged: p.merged,
      draft: p.draft,
      mergeable: p.mergeable ?? undefined,
      htmlUrl: p.html_url,
      body: p.body ?? undefined,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      mergedAt: p.merged_at,
      user: p.user?.login,
      headRef: p.head?.ref,
      headSha: p.head?.sha,
      baseRef: p.base?.ref,
      labels: this.labelNames(p.labels),
      milestone: p.milestone ? { id: p.milestone.number, title: p.milestone.title } : null,
      comments: p.comments,
    };
  }

  private mapRun(r: GhRun): ForgeRun {
    return {
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch ?? undefined,
      sha: r.head_sha,
      title: r.display_title ?? r.name,
      path: r.path,
      event: r.event,
      url: r.html_url,
      runNumber: r.run_number,
      startedAt: r.run_started_at ?? r.created_at,
      completedAt: r.status === 'completed' ? r.updated_at : undefined,
    };
  }

  // -- repo -----------------------------------------------------------------

  async listRepos(org: string): Promise<string[]> {
    const repos = await this.http.requestAll<{ name: string }>(`/orgs/${org}/repos`, {
      pageParam: 'per_page',
      cap: 200,
    });
    return repos.map((r) => `${org}/${r.name}`);
  }

  // -- issues ---------------------------------------------------------------

  async getIssue(repo: string, n: number): Promise<ForgeIssue> {
    return this.mapIssue(await this.req<GhIssue>(issuePath(repo, n)));
  }

  async listIssues(repo: string, state: 'open' | 'closed' | 'all'): Promise<ForgeIssue[]> {
    const items = await this.http.requestAll<GhIssue>(`${issuePath(repo)}?state=${state}`, {
      pageParam: 'per_page',
      cap: 500,
    });
    return items.filter((i) => !i.pull_request).map((i) => this.mapIssue(i));
  }

  async createIssue(repo: string, input: CreateIssueInput): Promise<ForgeIssue> {
    const created = await this.req<GhIssue>(issuePath(repo), 'POST', {
      title: input.title,
      body: input.body,
      labels: input.labels,
    });
    return this.mapIssue(created);
  }

  async updateIssue(repo: string, n: number, patch: IssuePatch): Promise<ForgeIssue> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.body !== undefined) body.body = patch.body;
    if (patch.state !== undefined) body.state = patch.state;
    if (patch.stateReason !== undefined) body.state_reason = patch.stateReason;
    if (Object.keys(body).length) await this.req(issuePath(repo, n), 'PATCH', body);
    if (patch.labels) {
      await this.req(`${issuePath(repo, n)}/labels`, 'PUT', { labels: patch.labels });
    }
    return this.getIssue(repo, n);
  }

  // -- comentarios ----------------------------------------------------------

  async listComments(repo: string, n: number): Promise<ForgeComment[]> {
    const out = await this.http.requestAll<GhComment>(`${issuePath(repo, n)}/comments`, {
      pageParam: 'per_page',
      cap: 1000,
    });
    return out.map((c) => this.mapComment(c));
  }

  async createComment(repo: string, n: number, body: string): Promise<void> {
    await this.req(`${issuePath(repo, n)}/comments`, 'POST', { body });
  }

  async updateComment(repo: string, commentId: number, body: string): Promise<void> {
    await this.req(`/repos/${repo}/issues/comments/${commentId}`, 'PATCH', { body });
  }

  // -- dependencias ---------------------------------------------------------

  async listDependencies(repo: string, n: number): Promise<ForgeIssue[]> {
    const out = await this.http.requestAll<GhIssue>(
      `${issuePath(repo, n)}/dependencies/blocked_by`,
      {
        pageParam: 'per_page',
        cap: 100,
      }
    );
    return out.map((i) => this.mapIssue(i));
  }

  async addDependencies(repo: string, n: number, blockers: number[]): Promise<void> {
    for (const b of blockers) {
      if (b === n) continue;
      // O corpo pede o id numerico da issue bloqueadora, nao o numero.
      const blocker = await this.getIssue(repo, b);
      await this.req(`${issuePath(repo, n)}/dependencies/blocked_by`, 'POST', {
        issue_id: blocker.id,
      }).catch((e: unknown) => {
        const status = (e as { status?: number }).status;
        if (status === 404) throw new Error(`issue #${b} nao existe em ${repo}`);
        // 422 = ja existe a aresta.
        if (status !== 422 && status !== 409) throw e;
      });
    }
  }

  async removeDependency(repo: string, n: number, blocker: number): Promise<void> {
    const target = await this.getIssue(repo, blocker);
    await this.req(`${issuePath(repo, n)}/dependencies/blocked_by/${target.id}`, 'DELETE').catch(
      (e: unknown) => {
        const status = (e as { status?: number }).status;
        if (status !== 404) throw e;
      }
    );
  }

  // -- milestones -----------------------------------------------------------

  async listMilestones(repo: string): Promise<ForgeMilestone[]> {
    const out = await this.http.requestAll<GhMilestone>(`/repos/${repo}/milestones?state=all`, {
      pageParam: 'per_page',
      cap: 200,
    });
    return out.map((m) => this.mapMilestone(m));
  }

  async createMilestone(
    repo: string,
    input: { title: string; description?: string }
  ): Promise<ForgeMilestone> {
    const created = await this.req<GhMilestone>(`/repos/${repo}/milestones`, 'POST', {
      title: input.title,
      description: input.description,
    });
    return this.mapMilestone(created);
  }

  async updateMilestone(
    repo: string,
    id: string | number,
    patch: { title?: string; description?: string; state?: 'open' | 'closed' }
  ): Promise<ForgeMilestone> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.state !== undefined) body.state = patch.state;
    const after = await this.req<GhMilestone>(
      `/repos/${repo}/milestones/${String(id)}`,
      'PATCH',
      body
    );
    return this.mapMilestone(after);
  }

  async setIssueMilestone(repo: string, n: number, milestoneId: string | number): Promise<void> {
    await this.req(issuePath(repo, n), 'PATCH', { milestone: Number(milestoneId) });
  }

  // -- pulls ----------------------------------------------------------------

  async listPulls(
    repo: string,
    opts: { state?: 'open' | 'closed' | 'all'; base?: string; head?: string; limit?: number }
  ): Promise<ForgePull[]> {
    const state = opts.state ?? 'open';
    const limit = opts.limit ?? 50;
    let q = `${pullPath(repo)}?state=${state}&per_page=${Math.max(limit, 50)}`;
    if (opts.base) q += `&base=${encodeURIComponent(opts.base)}`;
    if (opts.head) q += `&head=${encodeURIComponent(opts.head)}`;
    const list = await this.http.requestAll<GhPull>(q, { pageParam: 'per_page', cap: 200 });
    return list.slice(0, limit).map((p) => this.mapPull(p));
  }

  async getPull(repo: string, n: number): Promise<ForgePull> {
    return this.mapPull(await this.req<GhPull>(pullPath(repo, n)));
  }

  async listReviews(repo: string, n: number): Promise<ForgeReview[]> {
    const out = await this.http.requestAll<{
      id: number;
      state?: string;
      body?: string | null;
      user?: { login?: string };
      submitted_at?: string;
      html_url?: string;
    }>(`${pullPath(repo, n)}/reviews`, { pageParam: 'per_page', cap: 200 });
    return out.map((r) => ({
      id: r.id,
      state: r.state,
      body: r.body ?? undefined,
      user: r.user?.login,
      submittedAt: r.submitted_at,
      htmlUrl: r.html_url,
    }));
  }

  async listReviewComments(
    repo: string,
    n: number,
    reviewId: number
  ): Promise<ForgeReviewComment[]> {
    // GitHub lista inline de forma plana; filtra pelo review pedido.
    const out = await this.http.requestAll<{
      id: number;
      body?: string | null;
      path?: string;
      line?: number;
      original_line?: number;
      user?: { login?: string };
      created_at?: string;
      updated_at?: string;
      pull_request_review_id?: number;
    }>(`${pullPath(repo, n)}/comments`, { pageParam: 'per_page', cap: 500 });
    return out
      .filter((c) => c.pull_request_review_id === reviewId)
      .map((c) => ({
        id: c.id,
        body: c.body ?? undefined,
        path: c.path,
        position: c.line ?? c.original_line,
        user: c.user?.login,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }));
  }

  async getChecks(repo: string, sha: string): Promise<ForgeChecks | undefined> {
    if (!sha) return undefined;
    const [runs, status] = await Promise.all([
      this.http
        .request<{
          check_runs?: {
            name: string;
            status: string;
            conclusion?: string | null;
            details_url?: string;
          }[];
        }>(`/repos/${repo}/commits/${sha}/check-runs`, {
          pageParam: 'per_page',
          headers: { Accept: 'application/vnd.github+json' },
        })
        .catch(() => ({ check_runs: [] })),
      this.http
        .request<{
          state?: string;
          statuses?: {
            context: string;
            state: string;
            description?: string;
            target_url?: string;
          }[];
        }>(`/repos/${repo}/commits/${sha}/status`, { pageParam: 'per_page' })
        .catch(() => undefined),
    ]);

    const statuses: ForgeChecks['statuses'] = [];
    for (const s of status?.statuses ?? []) {
      statuses.push({
        context: s.context,
        status: s.state,
        description: s.description,
        url: s.target_url,
      });
    }
    for (const c of runs?.check_runs ?? []) {
      statuses.push({
        context: c.name,
        status: c.conclusion ?? c.status,
        url: c.details_url,
      });
    }
    if (!statuses.length && !status) return undefined;

    const failed = statuses.some((s) =>
      ['failure', 'error', 'cancelled', 'timed_out', 'action_required'].includes(s.status)
    );
    const pending = statuses.some((s) =>
      ['pending', 'queued', 'in_progress', 'requested', 'waiting', 'neutral'].includes(s.status)
    );
    const overall = failed
      ? 'failure'
      : pending
        ? 'pending'
        : statuses.length
          ? 'success'
          : 'unknown';
    return { overall, statuses };
  }

  async createPull(repo: string, input: CreatePullInput): Promise<ForgePull> {
    const created = await this.req<GhPull>(pullPath(repo), 'POST', {
      head: input.head,
      base: input.base,
      title: input.title,
      body: input.body ?? '',
      draft: input.draft ?? false,
    });
    return this.mapPull(created);
  }

  async mergePull(repo: string, n: number, style: MergeStyle): Promise<string> {
    // GitHub nao tem fast-forward-only. `rebase` e o mais proximo: aplica os
    // commits na base sem merge commit.
    const method = style === 'squash' ? 'squash' : style === 'merge' ? 'merge' : 'rebase';
    await this.req(`${pullPath(repo, n)}/merge`, 'PUT', { merge_method: method });
    return `merged (${style === 'fast-forward-only' ? 'rebase' : method})`;
  }

  // -- pipeline -------------------------------------------------------------

  async listRuns(repo: string, opts: ListRunsOptions): Promise<ForgeRun[]> {
    const limit = opts.limit ?? 10;
    let q = `/repos/${repo}/actions/runs?per_page=${Math.min(Math.max(limit, 20), 100)}`;
    if (opts.branch) q += `&branch=${encodeURIComponent(opts.branch)}`;
    if (opts.event) q += `&event=${opts.event}`;
    const data = await this.req<{ workflow_runs?: GhRun[] }>(q);
    let runs = data?.workflow_runs ?? [];
    if (opts.active) runs = runs.filter((r) => ACTIVE.has(r.status));
    return runs.slice(0, limit).map((r) => this.mapRun(r));
  }

  async getRun(repo: string, id: number): Promise<ForgeRun> {
    return this.mapRun(await this.req<GhRun>(`/repos/${repo}/actions/runs/${id}`));
  }

  async getRunLogs(repo: string, id: number, opts: LogsOptions): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/repos/${repo}/actions/runs/${id}/logs`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(this.http.redact(`log do run ${id} falhou (HTTP ${res.status})`));
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(buf);
    } catch {
      throw new Error(`o log do run ${id} nao veio como zip (${buf.length} bytes)`);
    }
    const decoder = new TextDecoder();
    const parts: string[] = [];
    for (const [name, data] of Object.entries(files)) {
      if (!name.endsWith('.txt')) continue;
      if (opts.step && !name.toLowerCase().includes(opts.step.toLowerCase())) continue;
      parts.push(`Job: ${name}\n${decoder.decode(data)}`);
    }
    if (!parts.length) {
      return opts.step ? `(nenhum job casou com "${opts.step}")` : '(log vazio)';
    }
    return shapeLog(parts.join('\n'), opts);
  }

  async getActionsConfig(repo: string): Promise<ForgeActionsConfig> {
    const [vars, secrets, wf] = await Promise.all([
      this.http
        .request<{ variables?: { name: string; value?: string }[] }>(
          `/repos/${repo}/actions/variables`,
          {
            pageParam: 'per_page',
          }
        )
        .catch(() => undefined),
      this.http
        .request<{ secrets?: { name: string }[] }>(`/repos/${repo}/actions/secrets`, {
          pageParam: 'per_page',
        })
        .catch(() => undefined),
      this.http
        .request<{
          workflows?: { id: string | number; name: string; path?: string; state?: string }[];
        }>(`/repos/${repo}/actions/workflows`, { pageParam: 'per_page' })
        .catch(() => undefined),
    ]);
    return {
      variables: (vars?.variables ?? []).map((v) => {
        const raw = v.value ?? '';
        return {
          name: v.name,
          value: raw.length > 60 ? `${raw.slice(0, 60)}...` : raw,
          lines: 1,
          chars: raw.length,
        };
      }),
      secrets: (secrets?.secrets ?? []).map((s) => s.name),
      workflows: (wf?.workflows ?? []).map((w) => ({
        id: String(w.id),
        name: w.name,
        path: w.path,
        state: w.state,
      })),
    };
  }

  async dispatchWorkflow(
    repo: string,
    workflow: string,
    ref: string,
    inputs?: Record<string, string>
  ): Promise<void> {
    await this.req(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      'POST',
      {
        ref,
        inputs: inputs ?? {},
      }
    );
  }

  async listRunners(repo: string): Promise<ForgeRunner[]> {
    const data = await this.req<{
      runners?: {
        id: number;
        name: string;
        status: string;
        busy: boolean;
        labels?: { name: string }[];
      }[];
    }>(`/repos/${repo}/actions/runners`);
    return (data?.runners ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      busy: r.busy,
      labels: r.labels?.map((l) => l.name),
    }));
  }

  // -- branches -------------------------------------------------------------

  async listBranches(repo: string): Promise<ForgeBranch[]> {
    const out = await this.http.requestAll<{ name: string; protected?: boolean }>(
      `/repos/${repo}/branches`,
      { pageParam: 'per_page', cap: 300 }
    );
    return out.map((b) => ({ name: b.name, protected: Boolean(b.protected) }));
  }

  async getBranchProtections(repo: string, branches: string[]): Promise<ForgeProtection[]> {
    const out: ForgeProtection[] = [];
    for (const branch of branches) {
      try {
        const p = await this.req<{
          required_pull_request_reviews?: { required_approving_review_count?: number } | null;
          enforce_admins?: { enabled?: boolean } | boolean;
          allow_force_pushes?: { enabled?: boolean } | boolean;
          allow_deletions?: { enabled?: boolean } | boolean;
        }>(`/repos/${repo}/branches/${encodeURIComponent(branch)}/protection`);
        const enforce =
          typeof p.enforce_admins === 'boolean' ? p.enforce_admins : p.enforce_admins?.enabled;
        const force =
          typeof p.allow_force_pushes === 'boolean'
            ? p.allow_force_pushes
            : p.allow_force_pushes?.enabled;
        const del =
          typeof p.allow_deletions === 'boolean' ? p.allow_deletions : p.allow_deletions?.enabled;
        const approvals = p.required_pull_request_reviews?.required_approving_review_count;
        const bits = [
          approvals != null ? `${approvals} aprovacao(oes)` : 'sem aprovacao obrigatoria',
          enforce ? 'admins incluidos' : 'admins fora',
          force ? 'force-push permitido' : 'force-push bloqueado',
          del ? 'delete permitido' : 'delete bloqueado',
        ];
        out.push({ branch, summary: bits.join(', '), raw: p });
      } catch (e) {
        if (e instanceof ForgeError && e.status === 404) {
          out.push({ branch, summary: 'sem protecao' });
          continue;
        }
        throw e;
      }
    }
    return out;
  }

  async compare(repo: string, base: string, head: string): Promise<ForgeCompare> {
    const data = await this.req<{
      ahead_by?: number;
      behind_by?: number;
      status?: string;
      commits?: { sha: string; commit?: { message?: string } }[];
    }>(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
    return {
      ahead: data.ahead_by ?? 0,
      behind: data.behind_by ?? 0,
      status: (data.status as ForgeCompare['status']) ?? 'identical',
      commits: (data.commits ?? []).map((c) => ({
        sha: c.sha,
        message: (c.commit?.message ?? '').split('\n')[0],
      })),
    };
  }

  // -- helper ---------------------------------------------------------------

  private req<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return this.http.request<T>(path, { pageParam: 'per_page', method, body });
  }
}
