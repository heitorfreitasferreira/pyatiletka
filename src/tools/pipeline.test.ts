import { beforeEach, describe, expect, it } from 'bun:test';
import type { ToolContext } from '@opencode-ai/plugin';
import { isRealPush, pipelineTools, pushedBranch } from './pipeline';
import { toV1Tools } from '../adapters/v1';
import { createPushHook, pushedRepo } from './push-hook';
import type { Ctx } from '../core/context';
import { FakeGitHost } from '../testing/fake-git-host';
import { makeConfig, REPO } from '../testing/fixtures';
import type { Run } from '../providers/types';

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

function ctxFor(f: FakeGitHost): Ctx {
  return {
    host: f,
    config: makeConfig(),
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

const run1 = (over: Partial<Run> = {}): Run => ({
  id: 100,
  status: 'completed',
  conclusion: 'success',
  branch: 'main',
  sha: 'aaaa1111',
  title: 'build da main',
  path: '.gitea/workflows/build.yml',
  event: 'push',
  runNumber: 12,
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:05:00Z',
  url: 'https://gitea.test/o/r/actions/runs/100',
  ...over,
});

beforeEach(() => {
  toasts.length = 0;
  host = new FakeGitHost({
    runs: [
      run1(),
      run1({
        id: 99,
        branch: 'feat/x',
        status: 'completed',
        conclusion: 'failure',
        title: 'build da branch',
      }),
    ],
    runLogs: {
      99: 'Job: test (ID: 3)\nbuilding...\nerror: 3 tests failed\nnpm ERR! exit code 1',
    },
    actions: {
      variables: [
        { name: 'REGISTRY', value: 'registry.test' },
        { name: 'SSH_KEYS', value: 'a b c', lines: 12, chars: 900 },
      ],
      secrets: ['TOKEN', 'DEPLOY_KEY'],
      workflows: [{ id: 'build', name: 'Build', state: 'active' }],
    },
    runners: [
      { id: 1, name: 'runner-1', status: 'online', busy: false, labels: ['linux'] },
      { id: 2, name: 'runner-2', status: 'offline', busy: true, labels: [] },
    ],
    repos: [REPO, 'org/outro'],
  });
  tools = toV1Tools(pipelineTools({ ctx: ctxFor(host) })) as never;
});

describe('pushedBranch', () => {
  it('le a branch de destino do push', () => {
    expect(pushedBranch('git push origin main:staging')).toBe('staging');
    expect(pushedBranch('git push origin feat/x')).toBe('feat/x');
    expect(pushedBranch('git push origin main:refs/heads/prod')).toBe('prod');
  });

  it('ignora flag no meio do comando', () => {
    expect(pushedBranch('git push --force-with-lease origin main:staging')).toBe('staging');
  });

  it('nao le branch quando o comando nao e push', () => {
    expect(pushedBranch('git log --oneline')).toBeUndefined();
  });
});

describe('isRealPush', () => {
  it('aceita push simples e com pipeline', () => {
    expect(isRealPush('git push origin main')).toBe(true);
    expect(isRealPush('cd /w && git push')).toBe(true);
  });

  it('recusa dry-run e force', () => {
    expect(isRealPush('git push --dry-run origin main')).toBe(false);
    expect(isRealPush('git push --force origin main')).toBe(false);
    expect(isRealPush('git push -f origin main')).toBe(false);
  });

  it('recusa comando que nao e push', () => {
    expect(isRealPush('git status')).toBe(false);
    expect(isRealPush('echo "git push"')).toBe(false);
  });
});

describe('ci_runs', () => {
  it('lista do repo padrao, todas as execucoes', async () => {
    const out = await run('ci_runs');
    expect(out).toContain('#100');
    expect(out).toContain('#99');
  });

  it('filtra por branch traz so aquela', async () => {
    const out = await run('ci_runs', { branch: 'feat/x' });
    expect(out).toContain('#99');
    expect(out).not.toContain('#100 ');
  });

  it('filtra por branch, event e active', async () => {
    expect(await run('ci_runs', { branch: 'feat/x' })).toContain('#99');
    expect(await run('ci_runs', { event: 'push' })).toContain('#100');
    expect(await run('ci_runs', { active: true })).toContain('Nenhuma execucao em org/repo');
    host.state.runs = [run1({ id: 98, status: 'in_progress', conclusion: null })];
    expect(await run('ci_runs', { active: true })).toContain('in_progress');
  });

  it('repos com glob mostra cada repo', async () => {
    expect(await run('ci_runs', { repos: ['outro'] })).toContain('org/outro');
  });

  it('repo sem execucao diz isso', async () => {
    host.state.runs = [];
    expect(await run('ci_runs')).toContain('Nenhuma execucao em org/repo');
  });
});

describe('ci_run', () => {
  it('traz estado, duracao, branch e url', async () => {
    const out = await run('ci_run', { run: '100' });
    expect(out).toContain('org/repo run #100 (nº 12) - completed/success em 5m');
    expect(out).toContain('branch:    main');
    expect(out).toContain('url:       https://gitea.test/o/r/actions/runs/100');
  });

  it('acrescenta o CI do commit', async () => {
    host.state.checks = {
      aaaa1111: { overall: 'success', statuses: [{ context: 'lint', status: 'success' }] },
    };
    expect(await run('ci_run', { run: '100' })).toContain('CI do commit: success');
  });

  it('id invalido e recusado', async () => {
    expect(await runFail('ci_run', { run: 'abc' })).toContain('execucao invalida');
  });
});

describe('ci_wait', () => {
  it('sem run e sem branch, recusa em vez de adivinhar', async () => {
    expect(await runFail('ci_wait')).toContain('Informe `run` (id da execucao) ou `branch`');
  });

  it('espera o run ja terminado', async () => {
    const out = await run('ci_wait', { run: '100' });
    expect(out).toContain('OK org/repo run #100');
    expect(toasts[0]?.message).toContain('ja terminou');
  });

  it('com branch, acha a execucao mais recente', async () => {
    const out = await run('ci_wait', { branch: 'feat/x' });
    expect(out).toContain('FALHOU org/repo run #99');
  });

  it('em falha, anexa as linhas de erro', async () => {
    const out = await run('ci_wait', { run: '99' });
    expect(out).toContain('linhas de erro');
    expect(out).toContain('3 tests failed');
  });

  it('logs_on_failure: false nao busca o log', async () => {
    await run('ci_wait', { run: '99', logs_on_failure: false });
    expect(host.called('getRunLogs')).toHaveLength(0);
  });

  it('branch sem execucao explica', async () => {
    expect(await runFail('ci_wait', { branch: 'nao-existe' })).toContain('Nenhuma execucao');
  });
});

describe('ci_logs', () => {
  it('repassa os filtros ao provider', async () => {
    await run('ci_logs', { run: '99', grep: 'error', tail: 10 });
    expect(host.called('getRunLogs')[0]?.args[2]).toEqual({
      full: undefined,
      step: undefined,
      grep: 'error',
      tail: 10,
    });
  });

  it('id invalido e recusado', async () => {
    expect(await runFail('ci_logs', { run: 'x' })).toContain('execucao invalida');
  });
});

describe('ci_config', () => {
  it('mostra variables, secrets e workflows, nunca o valor do secret', async () => {
    const out = await run('ci_config');
    expect(out).toContain('variables (2)');
    expect(out).toContain('REGISTRY=registry.test');
    expect(out).toContain('SSH_KEYS=a b c [12 linhas, 900 chars]');
    expect(out).toContain('secrets (2, valores ocultos): DEPLOY_KEY, TOKEN');
    expect(out).toContain('build - Build');
  });

  it('repo sem CI diz que nao tem', async () => {
    host.state.actions = { variables: [], secrets: [], workflows: [] };
    const out = await run('ci_config');
    expect(out).toContain('variables: (nenhuma');
    expect(out).toContain('workflows: (nenhum');
  });
});

describe('ci_dispatch', () => {
  it('dispara e aponta a execucao gerada', async () => {
    const out = await run('ci_dispatch', { workflow: 'build', ref: 'main' });
    expect(host.called('dispatchWorkflow')[0]?.args.slice(1, 3)).toEqual(['build', 'main']);
    expect(out).toContain('Dispatch aceito: build @ main');
    expect(out).toContain('Run gerado: #100');
  });

  it('sem ref e sem branch padrao, recusa', async () => {
    expect(await runFail('ci_dispatch', { workflow: 'build' })).toContain('Informe `ref`');
  });

  it('inputs vao junto', async () => {
    await run('ci_dispatch', { workflow: 'build', ref: 'main', inputs: { ambiente: 'prod' } });
    expect(host.called('dispatchWorkflow')[0]?.args[3]).toEqual({ ambiente: 'prod' });
  });
});

describe('ci_runners', () => {
  it('lista estado, busy e labels', async () => {
    const out = await run('ci_runners');
    expect(out).toContain('2 runner(s)');
    expect(out).toContain('runner-1');
    expect(out).toContain('(sem label)');
  });

  it('sem runner diz isso', async () => {
    host.state.runners = [];
    expect(await run('ci_runners')).toContain('Nenhum runner');
  });
});

describe('pushedRepo', () => {
  it('le o -C e o cd, e cai no directory', () => {
    expect(pushedRepo('git -C /w/sub push', '/w')).toBe('/w/sub');
    expect(pushedRepo('cd /w/sub && git push', '/w')).toBe('/w/sub');
    expect(pushedRepo('git push', '/w')).toBe('/w');
  });
});

describe('hook de push', () => {
  const hook = (timeoutMs = 900_000) =>
    createPushHook({
      ctx: ctxFor(host),
      directory: '/w',
      timeoutMs,
      wait: async () => {},
    });

  it('ignora tool que nao e bash', async () => {
    const output = { output: 'ok' };
    await hook()({ tool: 'read' }, output);
    expect(output.output).toBe('ok');
  });

  it('ignora push de teste ou forcado', async () => {
    const output = { output: 'ok' };
    await hook()({ tool: 'bash', args: { command: 'git push --dry-run origin main' } }, output);
    expect(output.output).toBe('ok');
  });

  it('repo sem workflow nao espera nada', async () => {
    host.state.actions = { variables: [], secrets: [], workflows: [] };
    const output = { output: 'ok' };
    await hook()({ tool: 'bash', args: { command: 'git push origin main' } }, output);
    expect(output.output).toBe('ok');
    expect(host.called('getRun')).toHaveLength(0);
  });

  it('confirma quando o run fica verde', async () => {
    const output = { output: 'pushed' };
    await hook()({ tool: 'bash', args: { command: 'git push origin main' } }, output);
    expect(output.output).toContain('run #100 verde');
  });

  it('reporta falha com as linhas de erro', async () => {
    const output = { output: 'pushed' };
    await hook()({ tool: 'bash', args: { command: 'git push origin main:feat/x' } }, output);
    expect(output.output).toContain('NAO passou pelo CI');
    expect(output.output).toContain('3 tests failed');
  });

  it('avisa quando o run nao termina no prazo', async () => {
    host.state.runs = [
      run1({ id: 100, status: 'in_progress', conclusion: null, completedAt: undefined }),
    ];
    const output = { output: 'pushed' };
    await hook(0)({ tool: 'bash', args: { command: 'git push origin main' } }, output);
    expect(output.output).toContain('o CI nao confirmou');
  });

  it('espera o run aparecer quando o webhook demora', async () => {
    let calls = 0;
    const late = new FakeGitHost({ runs: [], actions: host.state.actions });
    late.state.runs = [run1()];
    const originalList = late.listRuns.bind(late);
    late.listRuns = async (...a: Parameters<typeof originalList>) => {
      calls++;
      return calls <= 2 ? [] : originalList(...a);
    };
    const waits: number[] = [];
    const pushHook = createPushHook({
      ctx: { ...ctxFor(late), host: late },
      directory: '/w',
      wait: async (ms) => void waits.push(ms),
    });
    const output = { output: 'pushed' };
    await pushHook({ tool: 'bash', args: { command: 'git push origin main' } }, output);
    expect(waits.length).toBeGreaterThan(0);
    expect(output.output).toContain('verde');
  });
});
