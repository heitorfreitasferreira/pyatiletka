import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@opencode-ai/plugin';
import { issueTools } from './issues';
import { bindingFile, readBinding } from '../core/binding';
import type { Ctx } from '../core/context';
import { FakeForge } from '../testing/fake-forge';
import { makeComment, makeConfig, makeIssue, makeMilestone, REPO } from '../testing/fixtures';
import type { ProseMode } from '../prose';
const SESSION = 'ses_1';

let dir: string;
let forge: FakeForge;
let tools: Record<string, { execute: (a: unknown, c: ToolContext) => Promise<unknown> }>;

const toasts: { message: string; variant: string }[] = [];

function ctxFor(f: FakeForge, prose: ProseMode = 'block'): Ctx {
  return {
    forge: f,
    config: makeConfig({ prose }),
    remote: REPO,
    defaultRepo: REPO,
    notify: (message, variant = 'info') => void toasts.push({ message, variant }),
  };
}

const toolCtx = {
  sessionID: SESSION,
  messageID: 'm',
  agent: 'build',
  directory: '',
  worktree: '',
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext;

/** Roda a tool e devolve o texto, falhando se ela lancou. */
async function run(name: string, args: unknown = {}): Promise<string> {
  const out = await tools[name].execute(args, toolCtx);
  if (typeof out !== 'string') throw new Error(`${name} devolveu objeto, nao texto`);
  return out;
}

async function runFail(name: string, args: unknown = {}): Promise<string> {
  try {
    await tools[name].execute(args, toolCtx);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error(`${name} nao lancou erro`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-issues-'));
  toasts.length = 0;
  forge = new FakeForge({
    issues: [
      makeIssue({ number: 1, title: 'Corrigir fila', state: 'open', user: 'ana', comments: 2 }),
      makeIssue({
        number: 2,
        title: 'Escrever doc',
        state: 'closed',
        labels: ['Status/In Progress'],
        user: 'bruno',
        closedAt: '2026-02-02T00:00:00Z',
      }),
      makeIssue({
        number: 3,
        title: 'Travada',
        state: 'open',
        labels: ['Status/Blocked', 'Priority/Critical'],
        user: 'ana',
      }),
    ],
    comments: {
      1: [makeComment({ id: 1, body: 'primeiro' }), makeComment({ id: 2, body: 'segundo' })],
    },
    deps: { 3: [1] },
    milestones: [makeMilestone({ id: 13, title: 'Entrega', openIssues: 2, closedIssues: 1 })],
  });
  tools = issueTools({ ctx: ctxFor(forge), directory: dir }) as never;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('issue_bind', () => {
  it('grava o vinculo e devolve a issue', async () => {
    const out = await run('issue_bind', { issue: '1' });
    expect(out).toContain('Vinculado a org/repo#1');
    expect(readBinding(dir, SESSION)).toMatchObject({ repo: REPO, issue: 1 });
    expect(toasts[0]?.message).toContain('org/repo#1');
  });

  it('pega o marco da propria issue quando nenhum vem', async () => {
    forge.state.issues[0].milestone = { id: 13, title: 'Entrega' };
    await run('issue_bind', { issue: '1' });
    expect(readBinding(dir, SESSION)?.milestone).toBe('Entrega');
  });

  it('recusa issue que nao existe', async () => {
    expect(await runFail('issue_bind', { issue: '99' })).toContain('issue 99 nao existe');
  });
});

describe('issue_unbind', () => {
  it('apaga o vinculo', async () => {
    await run('issue_bind', { issue: '1' });
    expect(await run('issue_unbind')).toContain('desvinculada');
    expect(readBinding(dir, SESSION)).toBeUndefined();
  });

  it('diz que nao havia vinculo', async () => {
    expect(await run('issue_unbind')).toContain('ja estava desvinculada');
  });
});

describe('issue_binding', () => {
  it('sem vinculo, diz que nao ha', async () => {
    expect(await run('issue_binding')).toBe('Nenhuma issue vinculada nesta sessao.');
  });

  it('com vinculo, mostra repo, issue e marco', async () => {
    await run('issue_bind', { issue: '1', milestone: 'Entrega' });
    const out = await run('issue_binding');
    expect(out).toContain(`repo=${REPO} issue=1 marco=Entrega`);
    expect(out).toContain('#1 [open] Corrigir fila');
  });
});

describe('issue_view', () => {
  it('traz corpo e dependencias, com o estado de cada uma', async () => {
    const out = await run('issue_view', { issue: '3' });
    // A #1 esta aberta, entao a #3 aparece esperando ela e nao como resolvida.
    expect(out).toContain('depende de (1) - #1 [todo] Corrigir fila');
    expect(out).toContain('--- corpo ---');
  });

  it('dependencia resolvida aparece como OK', async () => {
    forge.state.issues[0].state = 'closed';
    expect(await run('issue_view', { issue: '3' })).toContain('depende de (1) - #1 [OK]');
  });

  it('sem dependencia, diz que nao tem', async () => {
    expect(await run('issue_view', { issue: '1' })).toContain('depende de: nada');
  });

  it('traz os comentarios', async () => {
    const out = await run('issue_view', { issue: '1' });
    expect(out).toContain('--- comentarios (2) ---');
    expect(out).toContain('primeiro');
    expect(out).toContain('segundo');
  });

  it('comments: 0 pula a secao de comentarios', async () => {
    expect(await run('issue_view', { issue: '1', comments: 0 })).not.toContain('--- comentarios');
  });

  it('comments: 1 traz so o mais recente', async () => {
    const out = await run('issue_view', { issue: '1', comments: 1 });
    expect(out).toContain('segundo');
    expect(out).not.toContain('primeiro');
  });

  it('avisa quando a API devolve menos comentarios que o contador', async () => {
    forge.state.issues[0].comments = 10;
    expect(await run('issue_view', { issue: '1' })).toContain('pode haver corte no servidor');
  });

  it('usa a issue vinculada quando nenhum numero vem', async () => {
    await run('issue_bind', { issue: '1' });
    expect(await run('issue_view')).toContain('#1 [open] Corrigir fila');
  });

  it('sem numero e sem vinculo, manda vincular', async () => {
    expect(await runFail('issue_view')).toContain('issue_bind');
  });
});

describe('issue_list', () => {
  it('default e aberta', async () => {
    const out = await run('issue_list');
    expect(out).toContain('#1 ');
    expect(out).not.toContain('#2 ');
  });

  it('state: all traz as fechadas tambem', async () => {
    expect(await run('issue_list', { state: 'all' })).toContain('#2 ');
  });

  it('filtra por estado logico', async () => {
    expect(await run('issue_list', { filter: 'blocked' })).toContain('#3');
    expect(await run('issue_list', { filter: 'done', state: 'all' })).toContain('#2');
  });

  it('filtra por autor e assignee', async () => {
    expect(await run('issue_list', { author: 'ana' })).not.toContain('#2');
    expect(await run('issue_list', { author: 'BRUNO', state: 'all' })).toContain('#2');
  });

  it('filtra por marco, por id e por titulo', async () => {
    forge.state.issues[0].milestone = { id: 13, title: 'Entrega' };
    expect(await run('issue_list', { milestone: '13' })).toContain('#1');
    expect(await run('issue_list', { milestone: 'entrega' })).toContain('#1');
  });

  it('filtra por janela de datas, com :created como padrao', async () => {
    forge.state.issues[0].createdAt = '2026-03-01T00:00:00Z';
    expect(await run('issue_list', { since: '2026-02-01' })).toContain('#1');
    expect(await run('issue_list', { since: '2026-04-01' })).not.toContain('#1');
  });

  it('until:created nao traz issue ainda aberta', async () => {
    expect(await run('issue_list', { until: '2026-02-01' })).not.toContain('#2');
  });

  it('until:closed traz a que fechou na janela', async () => {
    const out = await run('issue_list', { until: '2026-03-01:closed', state: 'all' });
    expect(out).toContain('#2');
    expect(out).not.toContain('#1');
  });

  it('ordena por prioridade e respeita o limite', async () => {
    forge.state.issues = [
      makeIssue({ number: 10, labels: ['Priority/Low'] }),
      makeIssue({ number: 11, labels: ['Priority/Critical'] }),
      makeIssue({ number: 12, labels: ['Priority/High'] }),
    ];
    const out = await run('issue_list', { limit: 2 });
    expect(out.indexOf('#11 [open]')).toBeLessThan(out.indexOf('#12 [open]'));
    expect(out).not.toContain('#10 [open]');
  });

  it('varios repos com glob, e o total no cabecalho', async () => {
    forge.state.repos = [REPO, 'org/outro'];
    const out = await run('issue_list', { repos: ['outro'] });
    // Duas abertas no estado default: a #2 esta fechada.
    expect(out).toContain('2 issue(s)');
    expect(out).toContain('org/outro ');
  });

  it('repos tem prioridade sobre o repo padrao', async () => {
    forge.state.repos = ['outro'];
    const out = await run('issue_list', { repos: ['outro'] });
    expect(out).not.toContain(`org/repo `);
  });
});

describe('issue_create', () => {
  it('sem template, aplica Priority/Medium por padrao', async () => {
    await run('issue_create', { title: 'Nova', body: 'texto' });
    expect(forge.called('createIssue')[0]?.args[1]).toMatchObject({ labels: ['Priority/Medium'] });
  });

  it('com template, monta corpo e aplica prefixo e labels do frontmatter', async () => {
    const f = join(dir, '.gitea/issue_template/task.md');
    mkdirSync(join(dir, '.gitea/issue_template'), { recursive: true });
    writeFileSync(f, '---\ntitle: "[Task] "\nlabels: [Kind/Task]\n---\ncorpo padrao');
    await run('issue_create', {
      title: 'Corrigir coisa',
      template: 'task',
      objetivo: 'a fila para de travar',
      criterios: ['teste passa', 'log limpo'],
    });
    const input = forge.called('createIssue')[0]?.args[1] as {
      title: string;
      body: string;
      labels: string[];
    };
    expect(input.title).toBe('[Task] Corrigir coisa');
    expect(input.labels).toEqual(['Kind/Task']);
    expect(input.body).toBe(
      '## Objetivo\n\na fila para de travar\n\n## Criterio de aceite\n\n- [ ] teste passa\n- [ ] log limpo'
    );
  });

  it('template sem objetivo e recusado', async () => {
    mkdirSync(join(dir, '.gitea/issue_template'), { recursive: true });
    writeFileSync(join(dir, '.gitea/issue_template/task.md'), 'corpo');
    expect(await runFail('issue_create', { title: 'x', template: 'task' })).toContain('objetivo');
  });

  it('body e template sao mutuamente exclusivos', async () => {
    expect(await runFail('issue_create', { title: 'x', body: 'y', template: 'task' })).toContain(
      'nao os dois'
    );
  });

  it('depende vai para a API, nao para o corpo', async () => {
    await run('issue_create', { title: 'x', body: 'y', depende: ['#1', 'abc'] });
    expect(forge.called('addDependencies')[0]?.args).toEqual([REPO, expect.any(Number), [1]]);
    expect(forge.called('createIssue')[0]?.args[1]).toMatchObject({ body: 'y' });
  });

  it('milestone por titulo parcial resolve e aplica', async () => {
    await run('issue_create', { title: 'x', body: 'y', milestone: 'Entre' });
    expect(forge.called('setIssueMilestone')[0]?.args[2]).toBe(13);
  });

  it('milestone ambiguo e recusado', async () => {
    forge.state.milestones.push(makeMilestone({ id: 14, title: 'Entrega extra' }));
    expect(await runFail('issue_create', { title: 'x', body: 'y', milestone: 'Entre' })).toContain(
      'casa com 2 marcos'
    );
  });

  it('prosa com travessao bloqueia e nada e gravado', async () => {
    const out = await runFail('issue_create', { title: 'x', body: 'faz o servidor — rapido' });
    expect(out).toContain('NAO foi gravado');
    expect(forge.called('createIssue')).toHaveLength(0);
  });

  it('prosa em warn devolve o aviso e grava', async () => {
    tools = issueTools({ ctx: ctxFor(forge, 'warn'), directory: dir }) as never;
    const out = await run('issue_create', { title: 'x', body: 'faz o servidor — rapido' });
    expect(out).toContain('unsloppify');
    expect(forge.called('createIssue')).toHaveLength(1);
  });
});

describe('issue_depend', () => {
  it('add cria a aresta e mostra o estado', async () => {
    const out = await run('issue_depend', { issue: '1', add: ['3'] });
    expect(forge.called('addDependencies')[0]?.args[2]).toEqual([3]);
    expect(out).toContain('#3 [open]');
  });

  it('remove tira a aresta', async () => {
    forge.state.deps[3] = [1];
    const out = await run('issue_depend', { issue: '3', remove: ['#1'] });
    expect(forge.called('removeDependency')[0]?.args).toEqual([REPO, 3, 1]);
    expect(out).toContain('(nenhuma)');
  });

  it('sem add nem remove, recusa', async () => {
    expect(await runFail('issue_depend', { issue: '1' })).toContain('informe `add` e/ou `remove`');
  });
});

describe('issue_comment', () => {
  it('publica na issue vinculada', async () => {
    await run('issue_bind', { issue: '1' });
    const out = await run('issue_comment', { body: '## Update 2026-01-01\n\nfeito' });
    expect(forge.called('createComment')[0]?.args).toEqual([
      REPO,
      1,
      '## Update 2026-01-01\n\nfeito',
    ]);
    expect(out).toContain('Comentario publicado em org/repo#1');
  });

  it('prosa com ponto e virgula bloqueia', async () => {
    await run('issue_bind', { issue: '1' });
    const out = await runFail('issue_comment', { body: 'fiz uma coisa; depois outra' });
    expect(out).toContain('ponto e virgula');
    expect(forge.called('createComment')).toHaveLength(0);
  });
});

describe('issue_update', () => {
  it('add_labels substitui o Status/ anterior', async () => {
    const out = await run('issue_update', { issue: '1', add_labels: ['Status/In Progress'] });
    const patch = forge.called('updateIssue')[0]?.args[2] as { labels: string[] };
    expect(patch.labels).toEqual(['Status/In Progress']);
    expect(out).toContain('status: in-progress');
  });

  it('remove_labels tira so o citado', async () => {
    await run('issue_update', { issue: '3', remove_labels: ['Status/Blocked'] });
    const patch = forge.called('updateIssue')[0]?.args[2] as { labels: string[] };
    expect(patch.labels).toEqual(['Priority/Critical']);
  });

  it('add_labels sem Status/ nao apaga os outros Status', async () => {
    forge.state.issues[2].labels = ['Status/Blocked', 'Kind/Bug'];
    await run('issue_update', { issue: '3', add_labels: ['Kind/Task'] });
    const patch = forge.called('updateIssue')[0]?.args[2] as { labels: string[] };
    expect(patch.labels.sort()).toEqual(['Kind/Bug', 'Kind/Task', 'Status/Blocked']);
  });

  it('so corpo, sem mexer em label', async () => {
    await run('issue_update', { issue: '1', body: 'novo corpo' });
    const patch = forge.called('updateIssue')[0]?.args[2] as Record<string, unknown>;
    expect(patch.body).toBe('novo corpo');
    expect(patch.labels).toBeUndefined();
  });

  it('sem campo, recusa', async () => {
    expect(await runFail('issue_update', { issue: '1' })).toContain('nada para atualizar');
  });
});

describe('issue_close e issue_reopen', () => {
  it('fecha com motivo padrao e comenta', async () => {
    const out = await run('issue_close', { issue: '1', comment: 'feito' });
    expect(forge.called('createComment')[0]?.args).toEqual([REPO, 1, 'feito']);
    expect(forge.called('updateIssue')[0]?.args[2]).toEqual({
      state: 'closed',
      stateReason: 'completed',
    });
    expect(out).toContain('org/repo#1 fechada');
  });

  it('fecha sem comentario quando o campo vem vazio', async () => {
    await run('issue_close', { issue: '1' });
    expect(forge.called('createComment')).toHaveLength(0);
  });

  it('aceita not_planned', async () => {
    await run('issue_close', { issue: '1', state_reason: 'not_planned' });
    expect(forge.called('updateIssue')[0]?.args[2]).toMatchObject({ stateReason: 'not_planned' });
  });

  it('comentario com travessao impede o fechamento', async () => {
    expect(await runFail('issue_close', { issue: '1', comment: 'pronto — pode subir' })).toContain(
      'travessao'
    );
    expect(forge.called('updateIssue')).toHaveLength(0);
  });

  it('reabre', async () => {
    expect(await run('issue_reopen', { issue: '2' })).toContain('reaberta');
    expect(forge.called('updateIssue')[0]?.args[2]).toEqual({ state: 'open' });
  });
});

describe('milestone_view', () => {
  beforeEach(() => {
    forge.state.issues = [
      makeIssue({
        number: 10,
        title: 'Fila trava',
        state: 'open',
        labels: ['Status/Blocked', 'Priority/Critical'],
        milestone: { id: 13, title: 'Entrega' },
      }),
      makeIssue({
        number: 11,
        title: 'Escrever doc',
        state: 'open',
        labels: ['Priority/High'],
        milestone: { id: 13, title: 'Entrega' },
      }),
      makeIssue({
        number: 12,
        title: 'Ajuste fino',
        state: 'open',
        labels: ['Priority/Low'],
        milestone: { id: 13, title: 'Entrega' },
      }),
      makeIssue({
        number: 20,
        title: 'Outro marco',
        state: 'open',
        milestone: { id: 99, title: 'Outro' },
      }),
    ];
    forge.state.deps = { 11: [12] };
  });

  it('so mostra as issues do marco pedido', async () => {
    const out = await run('milestone_view', { milestone: '13' });
    expect(out).toContain('#10');
    expect(out).toContain('#11');
    expect(out).not.toContain('#20');
  });

  it('monta cabecalho, bloqueios e proxima sugerida', async () => {
    const out = await run('milestone_view', { milestone: 'Entrega' });
    expect(out).toContain('org/repo marco #13 [open] Entrega');
    expect(out).toContain('progresso: 1/3 fechadas (33%)');
    // A #10 esta marcada como bloqueada e a #11 espera a #12, que esta aberta.
    expect(out).toContain('BLOQUEIOS (2)');
    expect(out).toContain('PROXIMA SUGERIDA: #12');
  });

  it('issue sem dependencia e a mais prioritária sai como proxima', async () => {
    forge.state.deps = {};
    const out = await run('milestone_view', { milestone: '13' });
    expect(out).toContain('BLOQUEIOS (1)');
    expect(out).toContain('PROXIMA SUGERIDA: #11');
  });

  it('marco sem issue no filtro diz isso', async () => {
    forge.state.issues = forge.state.issues.filter((i) => i.milestone?.id !== 13);
    expect(await run('milestone_view', { milestone: '13' })).toContain('sem issues open');
  });
});

describe('milestone_list e escrita', () => {
  it('lista com contagem e progresso', async () => {
    const out = await run('milestone_list');
    expect(out).toContain('#13 [open] Entrega - 1/3 (33%)');
  });

  it('filtra por estado', async () => {
    forge.state.milestones[0].state = 'closed';
    expect(await run('milestone_list', { state: 'open' })).toContain('Nenhum marco');
  });

  it('resolve um so por titulo', async () => {
    const out = await run('milestone_list', { milestone: 'Entre' });
    expect(out).toContain('#13');
    expect(out).not.toContain('#14');
  });

  it('create recusa titulo repetido', async () => {
    expect(await runFail('milestone_create', { title: 'entrega' })).toContain('marco ja existe');
  });

  it('update sem campo recusa', async () => {
    expect(await runFail('milestone_update', { milestone: '13' })).toContain('nada para atualizar');
  });

  it('update aplica o que veio', async () => {
    const out = await run('milestone_update', { milestone: '13', state: 'closed' });
    expect(forge.called('updateMilestone')[0]?.args[2]).toEqual({ state: 'closed' });
    expect(out).toContain('Marco atualizado: #13 [closed] Entrega');
  });
});

describe('issue_template_list', () => {
  it('sem template, diz onde procurou', async () => {
    const out = await run('issue_template_list');
    expect(out).toContain('.gitea/issue_template/');
    expect(out).toContain('.github/ISSUE_TEMPLATE/');
  });

  it('lista com about e labels', async () => {
    mkdirSync(join(dir, '.gitea/issue_template'), { recursive: true });
    writeFileSync(
      join(dir, '.gitea/issue_template/task.md'),
      '---\nabout: tarefa\nlabels: [Kind/Task]\n---\ncorpo'
    );
    const out = await run('issue_template_list');
    expect(out).toContain('about: tarefa');
    expect(out).toContain('labels: Kind/Task');
    expect(out).toContain('corpo');
  });
});

describe('vinculo em arquivo', () => {
  it('o vinculo fica em .opencode/.state/issue-sessions', async () => {
    await run('issue_bind', { issue: '1' });
    expect(readBinding(dir, SESSION)).toBeDefined();
    expect(bindingFile(dir, SESSION)).toContain('.opencode/.state/issue-sessions');
  });
});
