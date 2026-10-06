import { describe, expect, it } from 'bun:test';
import {
  branchOf,
  classify,
  dateField,
  dur,
  fmtComment,
  fmtIssue,
  isActive,
  priorityLabel,
  priorityOf,
} from './format';
import { makeComment, makeIssue } from '../testing/fixtures';

describe('classify', () => {
  it('issue fechada e done, com ou sem label', () => {
    expect(classify(makeIssue({ number: 1, state: 'closed' }))).toBe('done');
    expect(
      classify(makeIssue({ number: 1, state: 'closed', labels: ['Status/In Progress'] }))
    ).toBe('done');
  });

  it('label Status/ define o estado da issue aberta', () => {
    expect(classify(makeIssue({ number: 1 }))).toBe('todo');
    expect(classify(makeIssue({ number: 1, labels: ['Status/In Progress'] }))).toBe('in-progress');
    expect(classify(makeIssue({ number: 1, labels: ['Status/Need More Info'] }))).toBe('need-info');
    expect(classify(makeIssue({ number: 1, labels: ['Status/Blocked'] }))).toBe('blocked');
  });

  it('Blocked ganha de In Progress', () => {
    const i = makeIssue({ number: 1, labels: ['Status/In Progress', 'Status/Blocked'] });
    expect(classify(i)).toBe('blocked');
  });

  it('label de outra familia nao muda o estado', () => {
    expect(classify(makeIssue({ number: 1, labels: ['Priority/High', 'Kind/Bug'] }))).toBe('todo');
  });
});

describe('priorityOf', () => {
  it('ordena de Critical a Low, com Medium como padrao', () => {
    const rank = (p?: string) =>
      priorityOf(makeIssue({ number: 1, labels: p ? [`Priority/${p}`] : [] }));
    expect(rank('Critical')).toBe(0);
    expect(rank('High')).toBe(1);
    expect(rank('Medium')).toBe(2);
    expect(rank('Low')).toBe(3);
    expect(rank(undefined)).toBe(2);
  });

  it('pega a primeira label Priority/ que aparecer', () => {
    const i = makeIssue({ number: 1, labels: ['Priority/Critical', 'Priority/Low'] });
    expect(priorityOf(i)).toBe(0);
    expect(priorityLabel(i)).toBe('Priority/Critical');
  });
});

describe('dateField', () => {
  const i = makeIssue({
    number: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-02T00:00:00Z',
    closedAt: '2026-03-03T00:00:00Z',
  });

  it('created e o padrao', () => {
    expect(dateField('', i)).toBe('2026-01-01T00:00:00Z');
    expect(dateField('created', i)).toBe('2026-01-01T00:00:00Z');
  });

  it('updated e closed sao explicitos', () => {
    expect(dateField('updated', i)).toBe('2026-02-02T00:00:00Z');
    expect(dateField('closed', i)).toBe('2026-03-03T00:00:00Z');
  });

  it('closed_at ausente vira undefined, nao string vazia', () => {
    expect(dateField('closed', makeIssue({ number: 1 }))).toBeUndefined();
  });
});

describe('fmtIssue', () => {
  it('junta cabecalho, labels, marco, status e datas', () => {
    const out = fmtIssue(
      makeIssue({
        number: 42,
        title: 'Corrigir fila',
        labels: ['Status/In Progress', 'Priority/High'],
        milestone: { id: 7, title: 'Entrega' },
        comments: 3,
        user: 'ana',
        createdAt: '2026-01-01T09:00:00Z',
        updatedAt: '2026-01-05T09:00:00Z',
        htmlUrl: 'https://exemplo.test/r/i/42',
      })
    );
    expect(out).toContain('#42 [open] Corrigir fila');
    expect(out).toContain('labels: Status/In Progress, Priority/High');
    expect(out).toContain('marco: Entrega');
    expect(out).toContain('status: in-progress  prioridade: Priority/High');
    expect(out).toContain('comentarios: 3');
    expect(out).toContain('autor: ana');
    expect(out).toContain('criada: 2026-01-01');
    expect(out).toContain('atualizada: 2026-01-05');
    expect(out).toContain('https://exemplo.test/r/i/42');
  });

  it('nao mostra prioridade baixa', () => {
    expect(fmtIssue(makeIssue({ number: 1, labels: ['Priority/Low'] }))).not.toContain(
      'prioridade'
    );
  });

  it('omite linhas vazias', () => {
    const out = fmtIssue(makeIssue({ number: 1, title: 'So o titulo' }));
    expect(out).toBe('#1 [open] So o titulo\n  status: todo  prioridade: Priority/Medium');
  });
});

describe('fmtComment', () => {
  it('marca comentario editado', () => {
    const c = makeComment({
      id: 9,
      user: 'ana',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      body: '  texto  ',
    });
    const out = fmtComment(c);
    expect(out).toBe('--- [id 9] ana 2026-01-01T00:00:00Z (editado) ---\ntexto');
  });

  it('sem edicao, sem marcador', () => {
    const c = makeComment({
      id: 9,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(fmtComment(c)).not.toContain('editado');
  });

  it('corpo vazio vira (vazio)', () => {
    expect(fmtComment(makeComment({ id: 1, body: '' }))).toContain('(vazio)');
  });
});

describe('dur', () => {
  it('formata segundos, minutos e horas', () => {
    const at = (s: string) => ({
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: s,
      status: 'completed',
    });
    expect(dur(at('2026-01-01T00:00:30Z'))).toBe('30s');
    expect(dur(at('2026-01-01T00:05:00Z'))).toBe('5m');
    expect(dur(at('2026-01-01T02:30:00Z'))).toBe('2.5h');
  });

  it('timestamp de epoch conta como ausente', () => {
    const r = {
      startedAt: '1970-01-01T00:00:00Z',
      completedAt: '1970-01-01T00:00:10Z',
      status: 'cancelled',
    };
    expect(dur(r)).toBe('?');
  });

  it('run em andamento usa o agora', () => {
    const started = new Date(Date.now() - 120_000).toISOString();
    expect(dur({ startedAt: started, completedAt: undefined, status: 'in_progress' })).toBe('2m');
  });
});

describe('branchOf', () => {
  it('usa a branch quando veio', () => {
    expect(branchOf({ branch: 'main', title: 'from a into b', event: 'push' })).toBe('main');
  });

  it('sem branch, le head e base do titulo', () => {
    expect(branchOf({ title: 'Corrigir X from feat/y into main', event: 'pull_request' })).toBe(
      'feat/y -> main'
    );
  });

  it('PR sem branch nem titulo no formato esperado vira (PR)', () => {
    expect(branchOf({ title: 'Corrigir X', event: 'pull_request' })).toBe('(PR)');
    expect(branchOf({ event: 'schedule' })).toBe('?');
  });
});

describe('isActive', () => {
  it('cobre os estados de fila e execucao, sem diferenciar caixa', () => {
    for (const s of ['queued', 'in_progress', 'running', 'waiting', 'pending', 'IN_PROGRESS']) {
      expect(isActive(s)).toBe(true);
    }
    expect(isActive('completed')).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });
});
