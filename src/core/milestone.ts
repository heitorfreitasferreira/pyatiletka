import type { Issue, Milestone } from '../providers/types';
import { classify, priorityOf, priorityLabel, type IssueState } from './format';

/**
 * Resolucao de marco e montagem da fila. As funcs sao puras de proposito: quem
 * busca e quem decide o texto. `milestone_view` faz as chamadas, `issue_list`
 * filtra com `inMilestone` e `issue_create`/`milestone_update` resolvem o id
 * antes de gravar.
 */

/**
 * Resolve um marco por id (`13`, `#13`) ou por titulo parcial (`Lab`).
 * Quem vem de um comando ja passa o id, entao id tem precedencia.
 */
export function findMilestone(all: Milestone[], ref: string, repo: string): Milestone {
  const wanted = ref.trim().replace(/^#/, '');
  const byId = all.find((m) => String(m.id) === wanted);
  if (byId) return byId;

  const needle = wanted.toLowerCase();
  const byTitle = all.filter((m) => m.title.toLowerCase().includes(needle));
  if (byTitle.length === 1) return byTitle[0];
  if (!byTitle.length) {
    const open = all.filter((m) => m.state === 'open').map((m) => `#${m.id} ${m.title}`);
    throw new Error(
      `marco "${ref}" nao encontrado em ${repo}. Abre: ${open.join(' | ') || '(nenhum)'}`
    );
  }
  throw new Error(
    `"${ref}" casa com ${byTitle.length} marcos: ${byTitle
      .map((m) => `#${m.id} ${m.title}`)
      .join(' | ')}. Seja mais especifico (id ou titulo mais longo).`
  );
}

/** Casa o filtro de marco de `issue_list`: id numerico OU titulo parcial. */
export function inMilestone(i: Issue, ref: string): boolean {
  if (!i.milestone) return false;
  const wanted = ref.trim().replace(/^#/, '');
  return (
    String(i.milestone.id) === wanted ||
    i.milestone.title.toLowerCase().includes(wanted.toLowerCase())
  );
}

const GROUPS: { state: IssueState; title: string }[] = [
  { state: 'need-info', title: 'PRECISA DE RESPOSTA' },
  { state: 'in-progress', title: 'EM CURSO' },
  { state: 'todo', title: 'FILA (pronto para assumir)' },
  { state: 'done', title: 'ENCERRADAS' },
];

/** Dependencias de cada issue do marco, ja filtradas em dentro e fora. */
export type Deps = {
  /** Numeros que bloqueiam, dentro do proprio marco. */
  inside: Map<number, number[]>;
  /** Numeros que bloqueiam, de outros marcos. */
  outside: Map<number, number[]>;
};

export type Queue = {
  head: string[];
  sections: string[];
  suggestion: string[];
};

/**
 * A fila do `milestone_view`.
 *
 * `deps` vem das chamadas de dependencia, ja separadas em dentro e fora do
 * marco. Dependencia de outro marco continua valendo e aparece na linha como
 * `fora`: sem isso a issue pareceria livre quando nao esta.
 */
export function milestoneQueue(repo: string, ms: Milestone, items: Issue[], deps: Deps): Queue {
  const total = ms.openIssues + ms.closedIssues;
  const pct = total ? Math.round((ms.closedIssues / total) * 100) : 0;

  const byState = new Map<IssueState, Issue[]>();
  for (const i of items) {
    const k = classify(i);
    byState.set(k, [...(byState.get(k) ?? []), i]);
  }
  const counts = (['blocked', 'need-info', 'in-progress', 'todo', 'done'] as const)
    .filter((k) => byState.get(k)?.length)
    .map((k) => `${byState.get(k)!.length} ${k}`)
    .join(', ');

  const head = [
    `${repo} marco #${ms.id} [${ms.state}] ${ms.title}`,
    `  progresso: ${ms.closedIssues}/${total} fechadas (${pct}%)`,
    `  no filtro: ${items.length} issue(s) - ${counts}`,
  ];
  if (ms.dueOn) head.push(`  due: ${ms.dueOn}`);
  if (ms.description) {
    head.push('', '--- descricao do marco ---', ms.description.trim().slice(0, 4000));
  }

  const prio = (a: Issue, b: Issue) => priorityOf(a) - priorityOf(b) || a.number - b.number;
  const openInside = (n: number) => items.find((i) => i.number === n)?.state !== 'closed';

  const line = (i: Issue) => {
    const inside = deps.inside.get(i.number) ?? [];
    const waited = inside.filter(openInside);
    const outside = deps.outside.get(i.number) ?? [];
    return [
      ` #${i.number}`.padEnd(7),
      priorityLabel(i).replace('Priority/', ''),
      classify(i).padEnd(12),
      i.title.slice(0, 68),
      inside.length ? `  <- ${waited.length ? 'espera ' : 'ok '}${inside.join(', ')}` : '',
      outside.length ? `  [fora do marco: ${outside.map((n) => `#${n}`).join(', ')}]` : '',
      i.comments ? `  (${i.comments} com.)` : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  // Bloqueio e Status/Blocked mais quem espera por issue aberta do proprio marco.
  const marked = new Set((byState.get('blocked') ?? []).map((i) => i.number));
  const blocked = [
    ...(byState.get('blocked') ?? []),
    ...items.filter(
      (i) =>
        i.state !== 'closed' &&
        !marked.has(i.number) &&
        (deps.inside.get(i.number) ?? []).some(openInside)
    ),
  ];
  const blockedNumbers = new Set(blocked.map((i) => i.number));

  const sections: string[] = [];
  if (blocked.length) {
    sections.push(
      `BLOQUEIOS (${blocked.length}) - leia o corpo antes de assumir; se travar o marco inteiro, pergunte ao usuario`,
      ...blocked.map(line),
      ''
    );
  }
  for (const { state, title } of GROUPS) {
    const group = (byState.get(state) ?? []).filter(
      (i) => state === 'blocked' || !blockedNumbers.has(i.number)
    );
    if (!group.length) continue;
    sections.push(`${title} (${group.length})`, ...group.sort(prio).map(line), '');
  }

  // Proxima e a mais prioritaria entre as que nao esperam ninguem do marco.
  const ready = (byState.get('todo') ?? []).filter((i) => !blockedNumbers.has(i.number)).sort(prio);
  const first = ready[0];
  let suggestion: string[];
  if (first) {
    const inside = deps.inside.get(first.number) ?? [];
    const solved = inside.join(', ');
    suggestion = [
      `PROXIMA SUGERIDA: #${first.number} - ${first.title}`,
      `  (${priorityLabel(first)}; dependencias: ${inside.length ? `${solved} (resolvidas)` : 'nada'})`,
    ];
  } else if (byState.get('in-progress')?.length) {
    const ongoing = (byState.get('in-progress') as Issue[]).sort(prio)[0];
    suggestion = [`PROXIMA SUGERIDA: #${ongoing.number} - ja esta em curso, retome ela`];
  } else {
    suggestion = [
      'Nenhuma issue pronta: todas as abertas esperam por outra do marco ou estao bloqueadas.',
    ];
  }

  return { head, sections, suggestion };
}
