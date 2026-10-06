import { spawn } from 'node:child_process';
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
 * Provider Gitea. Fala a REST em `${GITEA_URL}/api/v1` e usa o binario `tea`
 * apenas onde a REST nao resolve (log de run e dispatch de workflow). O gate
 * de prosa, a fila de dependencias e a resolucao de repo moram no core.
 */

type GiteaIssue = {
  number: number;
  id: number;
  title: string;
  state: string;
  body?: string;
  html_url?: string;
  user?: { login?: string };
  assignees?: { login?: string }[];
  labels?: { name: string }[];
  milestone?: { id: number; title: string } | null;
  comments?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: unknown;
};

type GiteaMilestone = {
  id: number;
  title: string;
  description?: string;
  state: string;
  open_issues: number;
  closed_issues: number;
  due_on?: string | null;
};

type GiteaComment = {
  id: number;
  body?: string;
  user?: { login?: string };
  created_at?: string;
  updated_at?: string;
  html_url?: string;
};

type GiteaPull = {
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  mergeable?: boolean;
  html_url?: string;
  body?: string;
  created_at?: string;
  updated_at?: string;
  merged_at?: string | null;
  user?: { login?: string };
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  labels?: { name: string }[];
  milestone?: { id: number; title: string } | null;
  comments?: number;
};

type GiteaRun = {
  id: number;
  status: string;
  conclusion?: string | null;
  head_branch?: string;
  head_sha?: string;
  display_title?: string;
  path?: string;
  event?: string;
  html_url?: string;
  run_number?: number;
  started_at?: string;
  completed_at?: string;
};

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'running', 'pending']);

const issuePath = (repo: string, n?: number | string) =>
  `/repos/${repo}/issues${n === undefined ? '' : `/${String(n).replace(/^#/, '')}`}`;

const pullPath = (repo: string, n?: number | string) =>
  `/repos/${repo}/pulls${n === undefined ? '' : `/${String(n).replace(/^#/, '')}`}`;

type TeaResult = { code: number; out: string; err: string };

export class GiteaForge implements Forge {
  readonly provider = 'gitea' as const;
  private http: Http;

  constructor(private config: Config) {
    this.http = new Http('gitea', `${config.baseUrl}/api/v1`, config.token);
  }

  // -- tea -----------------------------------------------------------------

  private tea(args: string[], timeoutMs = 120_000): Promise<TeaResult> {
    return new Promise((resolve) => {
      const child = spawn('tea', args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      let settled = false;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, out: this.http.redact(out), err: this.http.redact(err) });
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(124);
      }, timeoutMs);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        err += String(e);
        finish(127);
      });
      child.on('close', (code) => finish(code ?? 0));
    });
  }

  private static stripTeaNoise(s: string) {
    return s
      .replace(/^NOTE:.*$/gm, '')
      .replace(/^\s*$/gm, '')
      .trim();
  }

  private static teaFail(r: TeaResult, what: string) {
    const err = r.err.replace(/^NOTE:.*$/gm, '').trim();
    if (r.code === 0) return '';
    return `${what} falhou (exit ${r.code}): ${(err || r.out).trim().slice(0, 600)}`;
  }

  // -- mapeadores -----------------------------------------------------------

  private mapIssue(i: GiteaIssue): ForgeIssue {
    return {
      number: i.number,
      id: i.id,
      title: i.title,
      state: i.state,
      body: i.body,
      htmlUrl: i.html_url,
      user: i.user?.login,
      assignees: i.assignees?.map((a) => a.login).filter((x): x is string => Boolean(x)),
      labels: (i.labels ?? []).map((l) => l.name),
      milestone: i.milestone ? { id: i.milestone.id, title: i.milestone.title } : null,
      comments: i.comments,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      closedAt: i.closed_at,
    };
  }

  private mapMilestone(m: GiteaMilestone): ForgeMilestone {
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      state: m.state,
      openIssues: m.open_issues,
      closedIssues: m.closed_issues,
      dueOn: m.due_on,
    };
  }

  private mapComment(c: GiteaComment): ForgeComment {
    return {
      id: c.id,
      body: c.body,
      user: c.user?.login,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      htmlUrl: c.html_url,
    };
  }

  private mapPull(p: GiteaPull): ForgePull {
    return {
      number: p.number,
      title: p.title,
      state: p.state,
      merged: p.merged,
      draft: p.draft,
      mergeable: p.mergeable,
      htmlUrl: p.html_url,
      body: p.body,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      mergedAt: p.merged_at,
      user: p.user?.login,
      headRef: p.head?.ref,
      headSha: p.head?.sha,
      baseRef: p.base?.ref,
      labels: (p.labels ?? []).map((l) => l.name),
      milestone: p.milestone ? { id: p.milestone.id, title: p.milestone.title } : null,
      comments: p.comments,
    };
  }

  private mapRun(r: GiteaRun): ForgeRun {
    return {
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch ?? this.branchFromTitle(r),
      sha: r.head_sha,
      title: r.display_title,
      path: r.path,
      event: r.event,
      url: r.html_url,
      runNumber: r.run_number,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    };
  }

  private branchFromTitle(r: GiteaRun): string | undefined {
    const m = r.display_title?.match(/\bfrom\s+(\S+)\s+into\s+(\S+)/);
    if (m) return `${m[1]} -> ${m[2]}`;
    if (r.event === 'pull_request') return '(PR)';
    return undefined;
  }

  // -- repo -----------------------------------------------------------------

  async listRepos(org: string): Promise<string[]> {
    const repos = await this.http.requestAll<{ name: string }>(`/orgs/${org}/repos`, {
      pageParam: 'limit',
      cap: 200,
    });
    return repos.map((r) => `${org}/${r.name}`);
  }

  // -- issues ---------------------------------------------------------------

  async getIssue(repo: string, n: number): Promise<ForgeIssue> {
    return this.mapIssue(
      await this.http.request<GiteaIssue>(issuePath(repo, n), { pageParam: 'limit' })
    );
  }

  async listIssues(repo: string, state: 'open' | 'closed' | 'all'): Promise<ForgeIssue[]> {
    const items = await this.http.requestAll<GiteaIssue>(
      `${issuePath(repo)}?state=${state}&type=issues`,
      { pageParam: 'limit', cap: 500 }
    );
    return items.map((i) => this.mapIssue(i));
  }

  async createIssue(repo: string, input: CreateIssueInput): Promise<ForgeIssue> {
    const labelIds = await this.resolveLabelIds(repo, input.labels);
    const created = await this.http.request<GiteaIssue>(issuePath(repo), {
      pageParam: 'limit',
      method: 'POST',
      body: { title: input.title, body: input.body, labels: labelIds },
    });
    return this.mapIssue(created);
  }

  async updateIssue(repo: string, n: number, patch: IssuePatch): Promise<ForgeIssue> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.body !== undefined) body.body = patch.body;
    if (patch.state !== undefined) body.state = patch.state;
    if (patch.stateReason !== undefined) body.state_reason = patch.stateReason;
    if (Object.keys(body).length) {
      await this.http.request(issuePath(repo, n), { pageParam: 'limit', method: 'PATCH', body });
    }
    if (patch.labels) {
      const ids = await this.resolveLabelIds(repo, patch.labels);
      await this.http.request(`${issuePath(repo, n)}/labels`, {
        pageParam: 'limit',
        method: 'PUT',
        body: { labels: ids },
      });
    }
    return this.getIssue(repo, n);
  }

  private async resolveLabelIds(repo: string, names: string[]): Promise<number[]> {
    if (!names.length) return [];
    const all = await this.http.requestAll<{ id: number; name: string }>(`/repos/${repo}/labels`, {
      pageParam: 'limit',
      cap: 500,
      perPage: 100,
    });
    const byName = new Map(all.map((l) => [l.name, l.id]));
    const ids: number[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const id = byName.get(name);
      if (id === undefined) missing.push(name);
      else ids.push(id);
    }
    if (missing.length) throw new Error(`labels inexistentes em ${repo}: ${missing.join(', ')}`);
    return ids;
  }

  // -- comentarios ----------------------------------------------------------

  async listComments(repo: string, n: number): Promise<ForgeComment[]> {
    const out = await this.http.request<GiteaComment[]>(`${issuePath(repo, n)}/comments`, {
      pageParam: 'limit',
    });
    return Array.isArray(out) ? out.map((c) => this.mapComment(c)) : [];
  }

  async createComment(repo: string, n: number, body: string): Promise<void> {
    await this.http.request(`${issuePath(repo, n)}/comments`, {
      pageParam: 'limit',
      method: 'POST',
      body: { body },
    });
  }

  async updateComment(repo: string, commentId: number, body: string): Promise<void> {
    await this.http.request(`/repos/${repo}/issues/comments/${commentId}`, {
      pageParam: 'limit',
      method: 'PATCH',
      body: { body },
    });
  }

  // -- dependencias ---------------------------------------------------------

  async listDependencies(repo: string, n: number): Promise<ForgeIssue[]> {
    const out = await this.http.requestAll<GiteaIssue>(`${issuePath(repo, n)}/dependencies`, {
      pageParam: 'limit',
      cap: 100,
    });
    return out.map((i) => this.mapIssue(i));
  }

  async addDependencies(repo: string, n: number, blockers: number[]): Promise<void> {
    const [owner, name] = repo.split('/');
    for (const b of blockers) {
      if (b === n) continue;
      await this.http
        .request(`${issuePath(repo, n)}/dependencies`, {
          pageParam: 'limit',
          method: 'POST',
          body: { index: b, owner, repo: name },
          retries: 0,
        })
        .catch((e: unknown) => {
          const status = (e as { status?: number }).status;
          if (status === 404) throw new Error(`issue #${b} nao existe em ${repo}`);
          // 500 = aresta ja existe. Nao e erro aqui.
          if (status !== 500) throw e;
        });
    }
  }

  async removeDependency(repo: string, n: number, blocker: number): Promise<void> {
    const [owner, name] = repo.split('/');
    await this.http
      .request(`${issuePath(repo, n)}/dependencies`, {
        pageParam: 'limit',
        method: 'DELETE',
        body: { index: blocker, owner, repo: name },
        retries: 0,
      })
      .catch((e: unknown) => {
        // DELETE responde 201 e da 500 quando a aresta nao existe: os dois
        // sao "ja removida" para quem pediu.
        const status = (e as { status?: number }).status;
        if (status !== 404 && status !== 500) throw e;
      });
  }

  // -- milestones -----------------------------------------------------------

  async listMilestones(repo: string): Promise<ForgeMilestone[]> {
    const out = await this.http.request<GiteaMilestone[]>(
      `/repos/${repo}/milestones?state=all&limit=50`,
      {
        pageParam: 'limit',
      }
    );
    return (Array.isArray(out) ? out : []).map((m) => this.mapMilestone(m));
  }

  async createMilestone(
    repo: string,
    input: { title: string; description?: string }
  ): Promise<ForgeMilestone> {
    const created = await this.http.request<GiteaMilestone>(`/repos/${repo}/milestones`, {
      pageParam: 'limit',
      method: 'POST',
      body: { title: input.title, description: input.description },
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
    await this.http.request(`/repos/${repo}/milestones/${String(id)}`, {
      pageParam: 'limit',
      method: 'PATCH',
      body,
    });
    const after = await this.http.request<GiteaMilestone>(
      `/repos/${repo}/milestones/${String(id)}`,
      {
        pageParam: 'limit',
      }
    );
    return this.mapMilestone(after);
  }

  async setIssueMilestone(repo: string, n: number, milestoneId: string | number): Promise<void> {
    await this.http.request(issuePath(repo, n), {
      pageParam: 'limit',
      method: 'PATCH',
      body: { milestone: Number(milestoneId) },
    });
  }

  // -- pulls ----------------------------------------------------------------

  async listPulls(
    repo: string,
    opts: { state?: 'open' | 'closed' | 'all'; base?: string; head?: string; limit?: number }
  ): Promise<ForgePull[]> {
    const state = opts.state ?? 'open';
    const limit = opts.limit ?? 50;
    let q = `${pullPath(repo)}?state=${state}&limit=${Math.max(limit, 50)}`;
    if (opts.base) q += `&base=${encodeURIComponent(opts.base)}`;
    const list = await this.http.requestAll<GiteaPull>(q, { pageParam: 'limit', cap: 100 });
    let filtered = list;
    if (opts.head) filtered = filtered.filter((p) => p.head?.ref?.includes(opts.head!));
    return filtered.slice(0, limit).map((p) => this.mapPull(p));
  }

  async getPull(repo: string, n: number): Promise<ForgePull> {
    return this.mapPull(
      await this.http.request<GiteaPull>(pullPath(repo, n), { pageParam: 'limit' })
    );
  }

  async listReviews(repo: string, n: number): Promise<ForgeReview[]> {
    const out = await this.http.request<
      {
        id: number;
        state?: string;
        body?: string;
        user?: { login?: string };
        submitted_at?: string;
        updated_at?: string;
        comments_count?: number;
        html_url?: string;
      }[]
    >(`${pullPath(repo, n)}/reviews`, { pageParam: 'limit' });
    return (Array.isArray(out) ? out : []).map((r) => ({
      id: r.id,
      state: r.state,
      body: r.body,
      user: r.user?.login,
      submittedAt: r.submitted_at ?? r.updated_at,
      commentsCount: r.comments_count,
      htmlUrl: r.html_url,
    }));
  }

  async listReviewComments(
    repo: string,
    n: number,
    reviewId: number
  ): Promise<ForgeReviewComment[]> {
    const out = await this.http.request<
      {
        id: number;
        body?: string;
        path?: string;
        position?: number;
        user?: { login?: string };
        created_at?: string;
        updated_at?: string;
      }[]
    >(`${pullPath(repo, n)}/reviews/${reviewId}/comments`, { pageParam: 'limit' });
    return (Array.isArray(out) ? out : []).map((c) => ({
      id: c.id,
      body: c.body,
      path: c.path,
      position: c.position,
      user: c.user?.login,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  async getChecks(repo: string, sha: string): Promise<ForgeChecks | undefined> {
    if (!sha) return undefined;
    try {
      const st = await this.http.request<{
        state?: string;
        statuses?: { context: string; status: string; description?: string; target_url?: string }[];
      }>(`/repos/${repo}/commits/${sha}/status`, { pageParam: 'limit' });
      return {
        overall: st.state ?? 'unknown',
        statuses: (st.statuses ?? []).map((s) => ({
          context: s.context,
          status: s.status,
          description: s.description,
          url: s.target_url,
        })),
      };
    } catch (e) {
      if (e instanceof ForgeError) return undefined;
      throw e;
    }
  }

  async createPull(repo: string, input: CreatePullInput): Promise<ForgePull> {
    const created = await this.http.request<GiteaPull>(pullPath(repo), {
      pageParam: 'limit',
      method: 'POST',
      body: {
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body ?? '',
      },
    });
    return this.mapPull(created);
  }

  async mergePull(repo: string, n: number, style: MergeStyle): Promise<string> {
    const Do =
      style === 'merge'
        ? 'merge'
        : style === 'squash'
          ? 'squash'
          : style === 'rebase'
            ? 'rebase'
            : 'ff-only';
    await this.http.request(`${pullPath(repo, n)}/merge`, {
      pageParam: 'limit',
      method: 'POST',
      body: { Do },
    });
    return `merged (${style})`;
  }

  // -- pipeline -------------------------------------------------------------

  async listRuns(repo: string, opts: ListRunsOptions): Promise<ForgeRun[]> {
    const limit = opts.limit ?? 10;
    let q = `/repos/${repo}/actions/runs?limit=${Math.max(limit, 20)}`;
    if (opts.branch) q += `&branch=${encodeURIComponent(opts.branch)}`;
    if (opts.event) q += `&event=${opts.event}`;
    const data = await this.http.request<{ workflow_runs?: GiteaRun[] }>(q, { pageParam: 'limit' });
    let runs = data?.workflow_runs ?? [];
    if (opts.active) runs = runs.filter((r) => ACTIVE.has(r.status));
    return runs.slice(0, limit).map((r) => this.mapRun(r));
  }

  async getRun(repo: string, id: number): Promise<ForgeRun> {
    return this.mapRun(
      await this.http.request<GiteaRun>(`/repos/${repo}/actions/runs/${id}`, { pageParam: 'limit' })
    );
  }

  async getRunLogs(repo: string, id: number, opts: LogsOptions): Promise<string> {
    const r = await this.tea(['actions', 'runs', 'logs', String(id), '--repo', repo], 180_000);
    const fail = GiteaForge.teaFail(r, `log do run ${id}`);
    if (fail) throw new Error(fail);
    let log = GiteaForge.stripTeaNoise(r.out);
    if (opts.step) {
      const blocks = log.split(/(?=^Job: )/m);
      const key = opts.step.toLowerCase();
      log = blocks.filter((b) => b.slice(0, 200).toLowerCase().includes(key)).join('');
      if (!log.trim()) return `(nenhum job casou com "${opts.step}")`;
    }
    return shapeLog(log, opts);
  }

  async getActionsConfig(repo: string): Promise<ForgeActionsConfig> {
    const [vars, secrets, wf] = await Promise.all([
      this.http
        .request<{ name: string; data?: string }[]>(`/repos/${repo}/actions/variables`, {
          pageParam: 'limit',
        })
        .catch(() => []),
      this.http
        .request<{ name: string }[]>(`/repos/${repo}/actions/secrets`, { pageParam: 'limit' })
        .catch(() => []),
      this.http
        .request<{ workflows?: { id: string; name: string; path?: string; state?: string }[] }>(
          `/repos/${repo}/actions/workflows`,
          { pageParam: 'limit' }
        )
        .catch(() => ({ workflows: [] })),
    ]);
    return {
      variables: (vars ?? []).map((v) => {
        const raw = v.data ?? '';
        const oneLine = raw.replace(/\s+/g, ' ').trim();
        return {
          name: v.name,
          value: oneLine.slice(0, 60),
          lines: raw.split('\n').filter((l) => l.trim()).length,
          chars: raw.length,
        };
      }),
      secrets: (secrets ?? []).map((s) => s.name),
      workflows: wf?.workflows ?? [],
    };
  }

  async dispatchWorkflow(
    repo: string,
    workflow: string,
    ref: string,
    inputs?: Record<string, string>
  ): Promise<void> {
    const argv = ['actions', 'workflows', 'dispatch', workflow, '--repo', repo, '--ref', ref];
    for (const [k, v] of Object.entries(inputs ?? {})) argv.push('-i', `${k}=${v}`);
    const r = await this.tea(argv, 90_000);
    const fail = GiteaForge.teaFail(r, `dispatch de ${workflow}`);
    if (fail) throw new Error(fail);
  }

  async listRunners(repo: string): Promise<ForgeRunner[]> {
    const org = repo.split('/')[0];
    const data = await this.http.request<{
      runners?: {
        id: number;
        name: string;
        status: string;
        busy: boolean;
        labels?: { name: string }[];
      }[];
    }>(`/orgs/${org}/actions/runners`, { pageParam: 'limit' });
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
    const out = await this.http.request<{ name: string; protected?: boolean }[]>(
      `/repos/${repo}/branches?limit=100`,
      {
        pageParam: 'limit',
      }
    );
    return (Array.isArray(out) ? out : []).map((b) => ({
      name: b.name,
      protected: Boolean(b.protected),
    }));
  }

  async getBranchProtections(repo: string, branches: string[]): Promise<ForgeProtection[]> {
    const all = await this.http
      .request<
        {
          branch?: string;
          rule_name?: string;
          required_approvals?: number;
          enable_push?: boolean;
        }[]
      >(`/repos/${repo}/branch_protections`, { pageParam: 'limit' })
      .catch(() => []);
    const wanted = new Set(branches);
    return (Array.isArray(all) ? all : [])
      .filter((p) => !wanted.size || wanted.has(p.branch ?? p.rule_name ?? ''))
      .map((p) => {
        const branch = p.branch ?? p.rule_name ?? '?';
        const bits = [
          p.enable_push === false ? 'push bloqueado' : 'push direto permitido',
          p.required_approvals != null ? `${p.required_approvals} aprovacao(oes)` : '',
        ].filter(Boolean);
        return { branch, summary: bits.join(', ') || 'sem detalhe', raw: p };
      });
  }

  async compare(repo: string, base: string, head: string): Promise<ForgeCompare> {
    const data = await this.http.request<{
      ahead_by?: number;
      behind_by?: number;
      status?: string;
      commits?: { sha: string; commit?: { message?: string } }[];
    }>(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, {
      pageParam: 'limit',
    });
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
}
