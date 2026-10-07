import { beforeEach, describe, expect, it } from 'bun:test';
import type { ToolContext } from '@opencode-ai/plugin';
import { filterDiffByPath, fmtPR, pullTools, statusOf, tailLines } from './pulls';
import { toV1Tools } from '../adapters/v1';
import type { Ctx } from '../core/context';
import { FakeGitHost } from '../testing/fake-git-host';
import { makeComment, makeConfig, REPO } from '../testing/fixtures';
import type { Pull } from '../providers/types';

let host: FakeGitHost;
let tools: Record<string, { execute: (a: unknown, c: ToolContext) => Promise<unknown> }>;
const toasts: { message: string; variant: string }[] = [];

const toolCtx = {
  sessionID: 'ses_1',
  messageID: 'm',
  agent: 'build',
  directory: '',
  worktree: '',
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
} as unknown as ToolContext;

function ctxFor(f: FakeGitHost, over: Partial<Ctx['config']> = {}): Ctx {
  return {
    host: f,
    config: makeConfig(over),
    remote: REPO,
    defaultRepo: REPO,
    notify: (message, variant = 'info') => void toasts.push({ message, variant }),
  };
}

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

const pull = (over: Partial<Pull> = {}): Pull => ({
  number: 1,
  title: 'Corrige a fila',
  state: 'open',
  htmlUrl: 'https://gitea.test/o/r/pulls/1',
  headRef: 'feat/fila',
  baseRef: 'main',
  headSha: 'abcdef1234567',
  user: 'ana',
  labels: [],
  milestone: null,
  ...over,
});

beforeEach(() => {
  toasts.length = 0;
  host = new FakeGitHost({
    pulls: [
      pull({ number: 1, headSha: 'aaaa1111', headRef: 'feat/fila', body: 'corpo do PR' }),
      // #2 exercita a porta de draft, #3 a de CI em falha, #4 o conflito,
      // #5 o PR ja mergeado.
      pull({
        number: 2,
        title: 'Doc',
        headSha: 'bbbb2222',
        headRef: 'doc',
        user: 'bruno',
        draft: true,
      }),
      pull({ number: 3, title: 'Quebrado', headSha: 'cccc3333', headRef: 'fix/x' }),
      pull({
        number: 4,
        title: 'Conflito',
        headSha: 'dddd4444',
        headRef: 'fix/y',
        mergeable: false,
      }),
      pull({
        number: 5,
        title: 'Antigo',
        state: 'closed',
        merged: true,
        headSha: 'eeee5555',
        headRef: 'velha',
      }),
    ],
    checks: {
      aaaa1111: { overall: 'success', statuses: [{ context: 'build', status: 'success' }] },
      bbbb2222: { overall: 'pending', statuses: [{ context: 'build', status: 'pending' }] },
      cccc3333: { overall: 'failure', statuses: [{ context: 'build', status: 'failure' }] },
      dddd4444: { overall: 'success', statuses: [{ context: 'build', status: 'success' }] },
      eeee5555: { overall: 'success', statuses: [{ context: 'build', status: 'success' }] },
    },
    comments: { 1: [makeComment({ id: 1, body: 'primeiro' })] },
    reviews: {
      1: [
        {
          id: 7,
          state: 'approved',
          user: 'bruno',
          submittedAt: '2026-01-01T00:00:00Z',
          body: 'ok',
          commentsCount: 1,
        },
      ],
    },
    reviewComments: {
      '1/7': [{ id: 3, body: 'ajusta aqui', path: 'src/a.ts', position: 12, user: 'bruno' }],
    },
    files: {
      1: [
        { filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 2, changes: 12 },
        { filename: 'src/b.ts', status: 'added', additions: 5, deletions: 0, changes: 5 },
      ],
    },
    diff: {
      1: [
        'diff --git a/src/a.ts b/src/a.ts',
        '+const x = 1',
        'diff --git a/src/b.ts b/src/b.ts',
        '+const y = 2',
      ].join('\n'),
    },
    repos: [REPO, 'org/outro'],
  });
  tools = toV1Tools(pullTools({ ctx: ctxFor(host) })) as never;
});

describe('statusOf', () => {
  it('sem check, libera o merge', () => {
    expect(statusOf(undefined).ok).toBe(true);
    expect(statusOf(undefined).total).toBe(0);
  });

  it('so verde quando o estado geral e success', () => {
    expect(
      statusOf({ overall: 'success', statuses: [{ context: 'a', status: 'success' }] }).ok
    ).toBe(true);
    expect(
      statusOf({ overall: 'pending', statuses: [{ context: 'a', status: 'pending' }] }).ok
    ).toBe(false);
  });

  it('separa falha de pendente', () => {
    const s = statusOf({
      overall: 'failure',
      statuses: [
        { context: 'a', status: 'failure' },
        { context: 'b', status: 'error' },
        { context: 'c', status: 'pending' },
      ],
    });
    expect(s.failed.map((x) => x.context)).toEqual(['a', 'b']);
    expect(s.pending.map((x) => x.context)).toEqual(['c']);
  });
});

describe('fmtPR', () => {
  it('marca draft, merged e conflito', () => {
    const out = fmtPR({ ...pull(), draft: true, mergeable: false });
    expect(out).toContain('[open/draft/conflito]');
  });

  it('acrescenta x quando o CI nao esta verde', () => {
    const out = fmtPR(pull(), {
      overall: 'failure',
      statuses: [{ context: 'a', status: 'failure' }],
    });
    expect(out).toContain('CI:failure x');
  });
});

describe('pr_list', () => {
  it('default e aberto, com o CI de cada PR', async () => {
    const out = await run('pr_list');
    expect(out).toContain('CI:success');
    expect(out).toContain('#1 ');
    expect(out).not.toContain('#5 ');
  });

  it('filtra por base, head e estado', async () => {
    expect(await run('pr_list', { head: 'doc' })).toContain('#2 ');
    expect(await run('pr_list', { base: 'outra' })).not.toContain('#1 ');
    expect(await run('pr_list', { state: 'all' })).toContain('#3 ');
  });

  it('mine usa o PYATILETKA_LOGIN', async () => {
    expect(await run('pr_list', { mine: true })).toContain('#1 ');
    expect(await run('pr_list', { mine: true })).not.toContain('#2 ');
  });

  it('mine sem PYATILETKA_LOGIN usa o usuario da credencial', async () => {
    tools = toV1Tools(pullTools({ ctx: ctxFor(host, { login: undefined }) })) as never;
    host.state.viewer = 'ana';
    expect(await run('pr_list', { mine: true })).toContain('#1 ');
  });

  it('repos com glob varre a org', async () => {
    const out = await run('pr_list', { repos: ['outro'] });
    expect(out).toContain('org/outro');
  });

  it('repo sem PR aberto diz isso', async () => {
    host.state.pulls = [];
    expect(await run('pr_list')).toContain('Nenhum PR open');
  });
});

describe('pr_view', () => {
  it('traz estado, CI, corpo, comentarios e reviews', async () => {
    const out = await run('pr_view', { pr: '1' });
    expect(out).toContain('org/repo#1 - Corrige a fila');
    expect(out).toContain('branches:  feat/fila -> main');
    expect(out).toContain('CI:        success');
    expect(out).toContain('--- corpo ---');
    expect(out).toContain('--- comentarios (1) ---');
    expect(out).toContain('--- reviews (1) ---');
    expect(out).toContain('inline [src/a.ts:12]');
  });

  it('comments: 0 pula a conversa', async () => {
    expect(await run('pr_view', { pr: '1', comments: 0 })).not.toContain('--- comentarios');
  });

  it('dessconta os reviews do total esperado de comentarios', async () => {
    host.state.pulls[0].comments = 5;
    expect(await run('pr_view', { pr: '1' })).toContain('a API devolveu 1 de 4 comentarios');
  });

  it('destaca CI nao verde com a contagem', async () => {
    const out = await run('pr_view', { pr: '3' });
    expect(out).toContain('x nao verde');
    expect(out).toContain('1 check(s) em falha');
  });
});

describe('pr_checks', () => {
  it('lista os checks e diz se esta verde', async () => {
    expect(await run('pr_checks', { pr: '1' })).toContain('CI success verde [1 checks]');
  });

  it('sem check, libera', async () => {
    host.state.checks = {};
    expect(await run('pr_checks', { pr: '1' })).toContain('Merge liberado');
  });
});

describe('pr_files', () => {
  it('soma as linhas e lista os arquivos', async () => {
    const out = await run('pr_files', { pr: '1' });
    expect(out).toContain('2 arquivo(s), +15 -2');
    expect(out).toContain('src/a.ts');
  });

  it('PR sem arquivo diz isso', async () => {
    expect(await run('pr_files', { pr: '3' })).toContain('nenhum arquivo');
  });
});

describe('pr_diff', () => {
  it('traz o diff cru', async () => {
    expect(await run('pr_diff', { pr: '1' })).toContain('+const x = 1');
  });

  it('path mantem o bloco e o cabecalho do arquivo', async () => {
    const out = await run('pr_diff', { pr: '1', path: 'src/a' });
    expect(out).toContain('+const x = 1');
    expect(out).not.toContain('src/b.ts');
  });

  it('grep filtra linha a linha', async () => {
    expect(await run('pr_diff', { pr: '1', grep: 'const y' })).toBe('+const y = 2');
  });

  it('regex invalida e recusada', async () => {
    expect(await runFail('pr_diff', { pr: '1', grep: '([' })).toContain('regex invalida em grep');
  });

  it('tail avisa quantas linhas havia', async () => {
    const out = await run('pr_diff', { pr: '1', tail: 1 });
    expect(out).toContain('4 linhas no total, ultimas 1');
  });

  it('diff vazio diz isso', async () => {
    expect(await run('pr_diff', { pr: '3' })).toContain('diff vazio');
  });
});

describe('filterDiffByPath e tailLines', () => {
  it('path sem match devolve vazio', () => {
    expect(filterDiffByPath('diff --git a/x b/x\n+y', 'zzz')).toBe('');
  });

  it('tail menor que o texto devolve o texto', () => {
    expect(tailLines('a\nb', 5)).toBe('a\nb');
  });
});

describe('pr_create', () => {
  it('abre com head, base e title', async () => {
    const out = await run('pr_create', { head: 'feat/x', base: 'main', title: 'Nova coisa' });
    expect(host.called('createPull')[0]?.args[1]).toMatchObject({
      head: 'feat/x',
      base: 'main',
      title: 'Nova coisa',
    });
    expect(out).toContain('PR aberto em org/repo#6');
  });

  it('descricao com travessao impede a abertura', async () => {
    const out = await runFail('pr_create', {
      head: 'a',
      base: 'b',
      title: 'c',
      body: 'muda tudo — rapido',
    });
    expect(out).toContain('NAO foi gravado');
    expect(host.called('createPull')).toHaveLength(0);
  });
});

describe('pr_merge', () => {
  it('mergeia com CI verde e default fast-forward-only', async () => {
    const out = await run('pr_merge', { pr: '1' });
    expect(host.called('mergePull')[0]?.args.slice(2)).toEqual([
      'fast-forward-only',
      { deleteBranch: false },
    ]);
    expect(out).toContain('merged (fast-forward-only)');
  });

  it('propaga delete_branch e o estilo pedido', async () => {
    await run('pr_merge', { pr: '1', style: 'squash', delete_branch: true });
    expect(host.called('mergePull')[0]?.args.slice(2)).toEqual(['squash', { deleteBranch: true }]);
  });

  it('CI pendente recusa e aponta o caminho', async () => {
    const out = await runFail('pr_merge', { pr: '3' });
    expect(out).toContain('CI nao verde');
    expect(out).toContain('ci_wait');
    expect(host.called('mergePull')).toHaveLength(0);
  });

  it('force passa pela porta', async () => {
    await run('pr_merge', { pr: '3', force: true });
    expect(host.called('mergePull')).toHaveLength(1);
  });

  it('draft recusa sem force', async () => {
    const out = await runFail('pr_merge', { pr: '2' });
    expect(out).toContain('draft');
  });

  it('conflito recusa mesmo com force', async () => {
    const out = await runFail('pr_merge', { pr: '4', force: true });
    expect(out).toContain('conflito');
    expect(host.called('mergePull')).toHaveLength(0);
  });

  it('PR ja merged nao mergeia de novo', async () => {
    expect(await run('pr_merge', { pr: '5' })).toContain('ja foi merged');
    expect(host.called('mergePull')).toHaveLength(0);
  });

  it('sem check de CI, mergeia', async () => {
    host.state.checks = {};
    await run('pr_merge', { pr: '1' });
    expect(host.called('mergePull')).toHaveLength(1);
  });
});

describe('pr_comment', () => {
  it('publica na conversa do PR', async () => {
    await run('pr_comment', { pr: '1', body: 'ajustei' });
    expect(host.called('createComment')[0]?.args).toEqual([REPO, 1, 'ajustei']);
  });

  it('texto com ponto e virgula bloqueia', async () => {
    expect(await runFail('pr_comment', { pr: '1', body: 'um; dois' })).toContain('ponto e virgula');
    expect(host.called('createComment')).toHaveLength(0);
  });
});

describe('pr_batch', () => {
  it('acha a branch em varios repos e reporta CI', async () => {
    const out = await run('pr_batch', { repos: ['*'], branch: 'feat/fila' });
    expect(out).toContain('2 repo(s), 2 verde(s)');
    expect(out).toContain('#1');
  });

  it('branch que nao existe vira linha informativa', async () => {
    const out = await run('pr_batch', { repos: ['*'], branch: 'nao-existe' });
    expect(out).toContain('sem PR open');
  });

  it('repo com erro nao derruba os outros', async () => {
    host.fail.set('listPulls', new Error('sem acesso'));
    const out = await run('pr_batch', { repos: ['*'], branch: 'feat/fila' });
    expect(out).toContain('sem acesso');
  });

  it('sem repos e sem pr, recusa', async () => {
    expect(await runFail('pr_batch', {})).toContain('informe `repos`');
  });
});
