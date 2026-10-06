import { describe, expect, it } from 'bun:test';
import { findMilestone, inMilestone, milestoneQueue, type Deps } from './milestone';
import { makeIssue, makeMilestone } from '../testing/fixtures';

const MS = makeMilestone({ id: 13, title: 'Entrega', openIssues: 4, closedIssues: 1 });

describe('findMilestone', () => {
  const all = [
    makeMilestone({ id: 13, title: 'Entrega' }),
    makeMilestone({ id: 7, title: 'Lab interno' }),
    makeMilestone({ id: 8, title: 'LabExterno', state: 'closed' }),
  ];

  it('id numerico, com ou sem #', () => {
    expect(findMilestone(all, '13', 'o/r')?.id).toBe(13);
    expect(findMilestone(all, '#13', 'o/r')?.id).toBe(13);
  });

  it('titulo parcial, quando casa com um so', () => {
    expect(findMilestone(all, 'entrega', 'o/r')?.id).toBe(13);
  });

  it('id ganha do titulo', () => {
    // O marco 7 tem "Lab" no titulo, mas o id pedido e 8.
    expect(findMilestone(all, '8', 'o/r')?.title).toBe('LabExterno');
  });

  it('titulo ambiguo lista os candidatos', () => {
    expect(() => findMilestone(all, 'Lab', 'o/r')).toThrow(/casa com 2 marcos/);
  });

  it('titulo sem match lista os marcos abertos', () => {
    expect(() => findMilestone(all, 'nada', 'o/r')).toThrow(/Abre: #13 Entrega \| #7 Lab interno/);
  });
});

describe('inMilestone', () => {
  const noMs = makeIssue({ number: 1 });
  const withMs = makeIssue({ number: 2, milestone: { id: 13, title: 'Entrega' } });

  it('issue sem marco nunca casa', () => {
    expect(inMilestone(noMs, '13')).toBe(false);
    expect(inMilestone(noMs, 'Entrega')).toBe(false);
  });

  it('casa por id e por titulo parcial', () => {
    expect(inMilestone(withMs, '13')).toBe(true);
    expect(inMilestone(withMs, '#13')).toBe(true);
    expect(inMilestone(withMs, 'entrega')).toBe(true);
    expect(inMilestone(withMs, 'Outro')).toBe(false);
  });
});

describe('milestoneQueue', () => {
  const deps = (m: Record<number, { inside: number[]; outside?: number[] }>): Deps => ({
    inside: new Map(Object.entries(m).map(([k, v]) => [Number(k), v.inside])),
    outside: new Map(Object.entries(m).map(([k, v]) => [Number(k), v.outside ?? []])),
  });

  const issue = (n: number, labels: string[], state = 'open') =>
    makeIssue({
      number: n,
      title: `tarefa ${n}`,
      labels,
      state,
      milestone: { id: 13, title: 'Entrega' },
    });

  it('cabecalho traz progresso e contagem por estado', () => {
    const items = [issue(1, ['Priority/High']), issue(2, ['Status/In Progress']), issue(3, [])];
    const { head } = milestoneQueue('o/r', MS, items, deps({}));
    expect(head[0]).toBe('o/r marco #13 [open] Entrega');
    expect(head[1]).toBe('  progresso: 1/5 fechadas (20%)');
    expect(head[2]).toContain('3 issue(s) - 1 in-progress, 2 todo');
  });

  it('BLOQUEIOS junta Status/Blocked e quem espera por issue aberta', () => {
    const items = [
      issue(1, ['Status/Blocked']),
      issue(2, []),
      issue(3, []),
      issue(4, ['Status/Blocked']),
    ];
    // 2 espera 3 (aberta). 4 e blocked. 1 e blocked.
    const q = milestoneQueue('o/r', MS, items, deps({ 2: { inside: [3] } }));
    const out = q.sections.join('\n');
    expect(out).toContain('BLOQUEIOS (3)');
    expect(out).toContain('#1');
    expect(out).toContain('#2');
    expect(out).toContain('#4');
  });

  it('quem espera so por issue fechada nao entra em BLOQUEIOS', () => {
    const items = [issue(1, [], 'closed'), issue(2, [])];
    const q = milestoneQueue('o/r', MS, items, deps({ 2: { inside: [1] } }));
    expect(q.sections.join('\n')).not.toContain('BLOQUEIOS');
  });

  it('dependencia de outro marco aparece como fora', () => {
    const items = [issue(2, [])];
    const q = milestoneQueue('o/r', MS, items, deps({ 2: { inside: [], outside: [99] } }));
    expect(q.sections.join('\n')).toContain('[fora do marco: #99]');
  });

  it('PROXIMA SUGERIDA pega a mais prioritaria pronta', () => {
    const items = [
      issue(1, ['Priority/Low']),
      issue(2, ['Priority/Critical']),
      issue(3, ['Priority/High']),
    ];
    const q = milestoneQueue('o/r', MS, items, deps({}));
    expect(q.suggestion[0]).toBe('PROXIMA SUGERIDA: #2 - tarefa 2');
    expect(q.suggestion[1]).toContain('Priority/Critical');
    expect(q.suggestion[1]).toContain('dependencias: nada');
  });

  it('issue bloqueada nao e sugerida', () => {
    const items = [issue(1, ['Priority/Critical']), issue(2, ['Priority/Low'])];
    const q = milestoneQueue('o/r', MS, items, deps({ 1: { inside: [2] } }));
    expect(q.suggestion[0]).toBe('PROXIMA SUGERIDA: #2 - tarefa 2');
  });

  it('sem issue pronta, aponta a que esta em curso', () => {
    const items = [issue(1, ['Status/In Progress']), issue(2, [])];
    const q = milestoneQueue('o/r', MS, items, deps({ 2: { inside: [1] } }));
    expect(q.suggestion[0]).toBe('PROXIMA SUGERIDA: #1 - ja esta em curso, retome ela');
  });

  it('sem nada pronto, diz que nao ha', () => {
    const items = [issue(1, ['Status/Blocked'])];
    const q = milestoneQueue('o/r', MS, items, deps({}));
    expect(q.suggestion[0]).toContain('Nenhuma issue pronta');
  });

  it('agrupa em EM CURSO, FILA e ENCERRADAS, com prioridade dentro do grupo', () => {
    const items = [issue(1, ['Priority/Low']), issue(2, ['Priority/High']), issue(3, [], 'closed')];
    const q = milestoneQueue('o/r', MS, items, deps({}));
    const start = q.sections.findIndex((s) => s.startsWith('FILA'));
    const fila = q.sections.slice(start, q.sections.indexOf('', start)).join('\n');
    expect(fila).toContain('#2');
    expect(fila.indexOf('#2')).toBeLessThan(fila.indexOf('#1'));
    expect(q.sections.join('\n')).toContain('ENCERRADAS (1)');
  });
});
