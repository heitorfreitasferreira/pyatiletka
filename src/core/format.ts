import type { IssueComment, Issue, Run } from '../providers/types';

/**
 * Formatacao de issue, comentario e run. Tudo aqui e puro: recebe o tipo
 * normalizado e devolve o texto que a tool mostra. Fica fora das tools porque
 * a mesma linha aparece em `issue_view`, `issue_list`, `milestone_view` e nos
 * hooks de contexto, e elas precisam concordar.
 */

/** Ordem canonica das familias de label. A primeira que aparecer manda. */
export const STATUS_LABEL = /^Status\//;
export const PRIORITY_LABEL = /^Priority\//;
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

export type IssueState = 'done' | 'blocked' | 'need-info' | 'in-progress' | 'todo';

/** Estado logico, derivado de `state` e das labels `Status/`. */
export function classify(i: Issue): IssueState {
  if (i.state === 'closed') return 'done';
  if (i.labels.includes('Status/Blocked')) return 'blocked';
  if (i.labels.includes('Status/Need More Info')) return 'need-info';
  if (i.labels.includes('Status/In Progress')) return 'in-progress';
  return 'todo';
}

/** Indice em `PRIORITIES`. Menor e mais urgente. `-1` quando a issue nao tem. */
export function priorityOf(i: Issue): number {
  const label = i.labels.find((l) => l.startsWith('Priority/'));
  return PRIORITIES.indexOf((label?.split('/')[1] ?? 'Medium') as (typeof PRIORITIES)[number]);
}

export function priorityLabel(i: Issue): string {
  return i.labels.find((l) => l.startsWith('Priority/')) ?? 'Priority/Medium';
}

/**
 * Campo de data usado por `since`/`until`.
 *
 * Aceita `YYYY-MM-DD` (createdAt, o comportamento antigo), `:updated`
 * (updatedAt) e `:closed` (closedAt). `closedAt` e o honesto para "fechada na
 * janela": `updatedAt` tambem anda com comentario e label, e `createdAt` perde
 * toda issue que nasceu antes da janela.
 */
export function dateField(kind: string, i: Issue): string | undefined {
  if (kind === 'updated') return i.updatedAt;
  if (kind === 'closed') return i.closedAt ?? undefined;
  return i.createdAt;
}

export function fmtIssue(i: Issue): string {
  const day = (v?: string | null) => (v ? v.slice(0, 10) : '');
  const meta = [
    i.user ? `autor: ${i.user}` : '',
    day(i.createdAt) ? `criada: ${day(i.createdAt)}` : '',
    day(i.updatedAt) ? `atualizada: ${day(i.updatedAt)}` : '',
    day(i.closedAt) ? `fechada: ${day(i.closedAt)}` : '',
  ].filter(Boolean);
  return [
    `#${i.number} [${i.state}] ${i.title}`,
    i.labels.length ? `  labels: ${i.labels.join(', ')}` : '',
    i.milestone ? `  marco: ${i.milestone.title}` : '',
    `  status: ${classify(i)}${priorityOf(i) < 3 ? `  prioridade: ${priorityLabel(i)}` : ''}`,
    i.comments ? `  comentarios: ${i.comments}` : '',
    meta.join('  '),
    i.htmlUrl ? `  ${i.htmlUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Bloco de comentario. O `[id ...]` e o que permite citar depois. */
export function fmtComment(c: IssueComment): string {
  const edited = c.updatedAt && c.createdAt && c.updatedAt !== c.createdAt ? ' (editado)' : '';
  return [
    `--- [id ${c.id}] ${c.user ?? '?'} ${c.createdAt ?? '?'}${edited} ---`,
    (c.body ?? '').trim() || '(vazio)',
  ].join('\n');
}

export function fmtReview(r: {
  id: number;
  state?: string;
  user?: string;
  submittedAt?: string;
}): string {
  return `--- [review ${r.id}] ${r.user ?? '?'} ${r.state ?? '?'} ${r.submittedAt ?? '?'} ---`;
}

export function fmtReviewComment(c: {
  body?: string;
  path?: string;
  position?: number;
  user?: string;
  createdAt?: string;
}): string {
  const where = c.path ? ` [${c.path}${c.position != null ? `:${c.position}` : ''}]` : '';
  return `  inline${where} ${c.user ?? '?'} ${c.createdAt ?? '?'}: ${(c.body ?? '').trim() || '(vazio)'}`;
}

/** Duracao do run. `?` quando nao ha timestamp confiavel. */
export function dur(run: Pick<Run, 'startedAt' | 'completedAt' | 'status'>): string {
  // Run nunca executado de fato (cancelado na fila) volta com epoch em
  // `startedAt`. Antes de 2000 conta como ausente, senao a conta sai em
  // milhoes de horas.
  const real = (v?: string) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) || t < Date.parse('2000-01-01T00:00:00Z') ? NaN : t;
  };
  const start = real(run.startedAt);
  if (Number.isNaN(start)) return '?';
  const completed = real(run.completedAt);
  const end = Number.isNaN(completed) ? (isActive(run.status) ? Date.now() : start) : completed;
  const ms = Math.max(0, end - start);
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export const isActive = (status?: string) => ACTIVE.has((status ?? '').toLowerCase());

const ACTIVE = new Set(['queued', 'in_progress', 'running', 'waiting', 'pending']);

/**
 * Branch do run. Run de `pull_request` chega sem `head_branch` em parte das
 * APIs, e o titulo "from <head> into <base>" e a unica fonte restante.
 */
export function branchOf(r: Pick<Run, 'branch' | 'title' | 'event'>): string {
  if (r.branch) return r.branch;
  const m = r.title?.match(/\bfrom\s+(\S+)\s+into\s+(\S+)/);
  if (m) return `${m[1]} -> ${m[2]}`;
  if (r.event === 'pull_request') return '(PR)';
  return '?';
}

export function runState(r: Pick<Run, 'status' | 'conclusion'>): string {
  return isActive(r.status) ? `▶ ${r.status}` : `${r.status}/${r.conclusion ?? '?'}`;
}

export function fmtRun(r: Run): string {
  return [
    `#${String(r.id).padEnd(5)}`,
    runState(r).padEnd(24),
    branchOf(r).padEnd(18).slice(0, 18),
    dur(r).padEnd(5),
    (r.title ?? r.path ?? '').slice(0, 72),
    r.sha ? r.sha.slice(0, 7) : '',
  ].join(' ');
}
