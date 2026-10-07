import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ToolContext } from '@opencode-ai/plugin';
import { branchTools, compareVerdict } from './branches';
import { toV1Tools } from '../adapters/v1';

/** Assercao de substring, para as mensagens de recusa ficarem legiveis. */
const contains = (haystack: string, needle: string) => expect(haystack).toContain(needle);
import { DEFAULT_PROMOTE_ORDER } from '../config';
import type { Ctx } from '../core/context';
import { cmp, FakeGitHost } from '../testing/fake-git-host';
import { makeConfig, REPO } from '../testing/fixtures';

let dir: string;
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

const build = (f: FakeGitHost, order?: string[]) =>
  toV1Tools(branchTools({ ctx: ctxFor(f), directory: dir, promoteOrder: order })) as never;

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

/** Cria um clone git de verdade, para `commit_list` e o push de `branch_promote`. */
function clone(name: string): string {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  const run2 = (args: string[]) =>
    execFileSync('git', args, {
      cwd: p,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Teste',
        GIT_AUTHOR_EMAIL: 'teste@test.invalid',
        GIT_COMMITTER_NAME: 'Teste',
        GIT_COMMITTER_EMAIL: 'teste@test.invalid',
      },
    });
  run2(['init', '-q', '-b', 'main']);
  run2(['config', 'user.email', 'teste@test.invalid']);
  run2(['config', 'user.name', 'Teste']);
  run2(['commit', '-q', '--allow-empty', '-m', 'inicial']);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-branch-'));
  toasts.length = 0;
  host = new FakeGitHost({
    branches: [
      { name: 'main', protected: true },
      { name: 'staging', protected: true },
      { name: 'production', protected: true },
    ],
    protections: [
      {
        branch: 'main',
        summary: 'push bloqueado, 2 aprovacao(oes)',
        raw: {
          required_approvals: 2,
          enable_status_check: true,
          status_check_contexts: ['build', 'lint'],
          block_on_rejected_reviews: true,
          protected_file_patterns: '*.env',
        },
      },
    ],
    // `branch_compare` pede base...head e `branch_promote` pede destino...origem.
    compare: {
      'staging...main': cmp({
        behind: 0,
        ahead: 3,
        commits: [{ sha: 'abc1234def', message: 'primeiro\ndetalhe' }],
      }),
      'production...main': cmp({ behind: 1, ahead: 3 }),
      'production...staging': cmp({ behind: 0, ahead: 0 }),
      'main...staging': cmp({ behind: 0, ahead: 2 }),
    },
  });
  tools = build(host) as never;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('DEFAULT_PROMOTE_ORDER', () => {
  it('vai de staging para production', () => {
    expect(DEFAULT_PROMOTE_ORDER).toEqual(['staging', 'production']);
  });
});

describe('compareVerdict', () => {
  it('identicas', () => {
    expect(compareVerdict('a', 'b', cmp())).toBe('ja identicas');
  });

  it('base contem head', () => {
    expect(compareVerdict('a', 'b', cmp({ behind: 2 }))).toContain('nao ha o que sincronizar');
  });

  it('head a frente sem divergencia', () => {
    expect(compareVerdict('a', 'b', cmp({ ahead: 2 }))).toContain('e ancestral de b');
  });

  it('divergentes', () => {
    expect(compareVerdict('a', 'b', cmp({ ahead: 2, behind: 1 }))).toContain('divergentes');
  });
});

describe('branch_protections', () => {
  it('lista branches e regras, com os detalhes do servidor', async () => {
    const out = await run('branch_protections');
    expect(out).toContain('main, staging, production');
    expect(out).toContain('main: push bloqueado, 2 aprovacao(oes)');
    expect(out).toContain('status check exigido: build, lint');
    expect(out).toContain('review negativa bloqueia o merge');
    expect(out).toContain('padroes protegidos: *.env');
  });

  it('repo sem regra diz isso', async () => {
    host.state.protections = [];
    expect(await run('branch_protections')).toContain('Nenhuma branch protegida');
  });

  it('regra sem detalhe cru mostra so o resumo', async () => {
    host.state.protections = [{ branch: 'main', summary: 'push bloqueado' }];
    const out = await run('branch_protections');
    expect(out).toContain('main: push bloqueado');
    expect(out).not.toContain('status check exigido');
  });
});

describe('branch_compare', () => {
  it('diz o status, os numeros e os commits a propagar', async () => {
    const out = await run('branch_compare', { base: 'staging', head: 'main' });
    expect(out).toContain('org/repo: main -> staging');
    expect(out).toContain('e ancestral de main');
    expect(out).toContain('main a frente: 3');
    expect(out).toContain('abc1234');
  });

  it('divergente manda resolver localmente e nao promover', async () => {
    const out = await run('branch_compare', { base: 'production', head: 'main' });
    expect(out).toContain('divergentes');
    expect(out).toContain('Nao promova direto');
  });

  it('identicas nao sugere nada', async () => {
    const out = await run('branch_compare', { base: 'production', head: 'staging' });
    expect(out).toContain('Nada a fazer');
  });

  it('avisa que ja existe PR aberto entre as duas', async () => {
    host.state.pulls = [
      {
        number: 7,
        title: 'PR',
        state: 'open',
        headRef: 'main',
        baseRef: 'staging',
        labels: [],
      },
    ];
    expect(await run('branch_compare', { base: 'staging', head: 'main' })).toContain(
      'PR aberto ja existe: #7'
    );
  });

  it('sem divergencia e sem PR, sugere branch_promote', async () => {
    expect(await run('branch_compare', { base: 'staging', head: 'main' })).toContain(
      'branch_promote'
    );
  });
});

describe('branch_compare com ref inexistente', () => {
  it('nomeia a branch que falta e lista as que existem', async () => {
    const out = await runFail('branch_compare', { base: 'nao-existe', head: 'main' });
    contains(out, 'branch base "nao-existe" nao existe');
    contains(out, 'staging, production');
  });

  it('confere o head tambem', async () => {
    const out = await runFail('branch_compare', { base: 'main', head: 'nao-existe' });
    contains(out, 'branch head "nao-existe" nao existe');
  });

  it('nao chama o compare quando a ref falta', async () => {
    await runFail('branch_compare', { base: 'nao-existe', head: 'main' });
    expect(host.called('compare')).toHaveLength(0);
  });
});

describe('branch_promote', () => {
  it('branch fora da ordem e recusada', async () => {
    expect(await runFail('branch_promote', { from: 'main' })).toContain('PYATILETKA_PROMOTE_ORDER');
  });

  it('branch fora da ordem e recusada antes de procurar o repo', async () => {
    const semRepo: Ctx = {
      host: host,
      config: makeConfig({ org: undefined }),
      notify: () => {},
    };
    const t = toV1Tools(branchTools({ ctx: semRepo, directory: '/nao-existe' }));
    try {
      await t.branch_promote.execute({ from: 'nao-existe' }, toolCtx);
      throw new Error('nao lancou');
    } catch (e) {
      // A mensagem tem de ser da branch, nao do repo ausente.
      expect((e as Error).message).toContain('nao esta na ordem de promocao');
    }
  });

  it('ultima da ordem nao tem para onde subir', async () => {
    expect(await run('branch_promote', { from: 'production' })).toContain('nada a promover');
  });

  it('promover para tras e recusado', async () => {
    expect(await runFail('branch_promote', { from: 'production', to: ['staging'] })).toContain(
      'promocao invalida'
    );
  });

  it('dry_run relata sem fazer push', async () => {
    tools = build(host, ['main', 'staging']) as never;
    const out = await run('branch_promote', { from: 'main', dry_run: true });
    expect(out).toContain('main -> staging: propagaria 3 commit(s) [dry-run]');
    expect(out).toContain('Nada foi propagado');
  });

  it('destino que nao tem o que receber diz que nao ha o que fazer', async () => {
    const out = await run('branch_promote', { from: 'staging' });
    expect(out).toContain('staging -> production: nada a fazer');
    expect(out).toContain('Nada foi propagado');
  });

  it('destino divergente e pulado, e a cadeia continua', async () => {
    tools = build(host, ['main', 'staging', 'production']) as never;
    const out = await run('branch_promote', { from: 'main', dry_run: true });
    // staging tem o que receber; production esta divergente e e pulada.
    expect(out).toContain('main -> staging: propagaria 3 commit(s) [dry-run]');
    expect(out).toContain('main -> production: DIVERGENTE');
  });

  it('ordem configuravel muda o destino padrao', async () => {
    tools = build(host, ['main', 'staging', 'production']) as never;
    expect(await run('branch_promote', { from: 'main' })).toContain(
      'promocao main -> [staging, production]'
    );
    tools = build(host, ['main', 'staging']) as never;
    expect(await run('branch_promote', { from: 'main' })).toContain('promocao main -> [staging]');
  });

  it('destino que nao existe: o push cria a branch', async () => {
    host.state.branches = [
      { name: 'main', protected: true },
      { name: 'staging', protected: true },
    ];
    tools = build(host, ['staging', 'nova-producao']) as never;
    const out = await run('branch_promote', { from: 'staging', dry_run: true });
    contains(out, 'destino nao existe, o push criaria a branch');
    contains(out, 'staging -> nova-producao');
  });

  it('destino novo com dry_run nao tenta comparar nem fazer push', async () => {
    host.state.branches = [
      { name: 'main', protected: true },
      { name: 'staging', protected: true },
    ];
    tools = build(host, ['staging', 'nova-producao']) as never;
    await run('branch_promote', { from: 'staging', dry_run: true });
    // O compare 404 quando a ref base nao existe; nao chega a ser chamado.
    expect(host.called('compare')).toHaveLength(0);
  });

  it('origem que nao existe e recusada com o nome dela', async () => {
    host.state.branches = [{ name: 'main', protected: true }];
    tools = build(host, ['fantasma', 'staging']) as never;
    const out = await runFail('branch_promote', { from: 'fantasma' });
    contains(out, 'branch de origem "fantasma" nao existe');
  });

  it('sem clone local, diz o comando para rodar na mao', async () => {
    tools = build(host, ['main', 'staging']) as never;
    const out = await run('branch_promote', { from: 'main' });
    expect(out).toContain('SEM CLONE LOCAL de org/repo');
    expect(out).toContain('git -C <repo> push origin main:staging');
  });

  it('com clone local, faz o push e confirma', async () => {
    // O remoto e um bare de verdade: um repo normal recusa push na branch
    // checada.
    const remote = join(dir, 'remoto.git');
    mkdirSync(remote, { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { encoding: 'utf8' });

    const local = clone('repo');
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: local });
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: local, encoding: 'utf8' });
    execFileSync('git', ['checkout', '-q', '-b', 'staging'], { cwd: local });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'y'], {
      cwd: local,
      encoding: 'utf8',
    });

    tools = build(host, ['staging', 'main']) as never;
    const out = await run('branch_promote', { from: 'staging', to: ['main'] });
    // `main...staging` no fixture e que compara destino...origem.
    expect(out).toContain('propagados (push fast-forward)');
    expect(out).toContain('Branches atualizadas: main');
    expect(toasts[0]?.variant).toBe('success');
  });
});

describe('commit_list', () => {
  it('sem clone local, diz onde rodar', async () => {
    const out = await run('commit_list');
    expect(out).toContain('SEM CLONE LOCAL de org/repo');
  });

  it('lista os commits do clone, em ordem e com o autor', async () => {
    clone('repo');
    const out = await run('commit_list', { branch: 'main' });
    expect(out).toContain('org/repo: 1 commit(s)');
    expect(out).toContain('| inicial');
    expect(out).toContain('Teste');
  });

  it('filtra por branch', async () => {
    const p = clone('repo');
    execFileSync('git', ['checkout', '-q', '-b', 'outra'], { cwd: p, encoding: 'utf8' });
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'segundo'], {
      cwd: p,
      encoding: 'utf8',
    });

    expect(await run('commit_list', { branch: 'outra' })).toContain('segundo');
    expect(await run('commit_list', { branch: 'outra' })).not.toContain('primeiro');
  });

  it('filtra por autor que nao casa', async () => {
    clone('repo');
    expect(await run('commit_list', { author: 'ninguem' })).toContain('nenhum commit na janela');
  });

  it('branch inexistente devolve o erro do git', async () => {
    clone('repo');
    expect(await run('commit_list', { branch: 'nao-existe' })).toContain('git log falhou');
  });
});
