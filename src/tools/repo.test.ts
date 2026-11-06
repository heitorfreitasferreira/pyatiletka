import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolContext } from '@opencode-ai/plugin';
import { repoTools } from './repo';
import { toV1Tools } from '../adapters/v1';
import { FakeGitHost } from '../testing/fake-git-host';
import { makeConfig, REPO } from '../testing/fixtures';

let dir: string;
let host: FakeGitHost;
let tools: Record<string, { execute: (a: unknown, c: ToolContext) => Promise<unknown> }>;

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

function ctxFor(f: FakeGitHost) {
  return {
    host: f,
    config: makeConfig(),
    remote: REPO,
    defaultRepo: REPO,
    notify: () => {},
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-repo-'));
  host = new FakeGitHost({
    actions: {
      variables: [
        { name: 'REGISTRY', value: 'registry.test', lines: 1, chars: 14 },
        { name: 'SSH_KEYS', value: 'a b c', lines: 12, chars: 900 },
      ],
      secrets: ['DEPLOY_KEY', 'TOKEN'],
      workflows: [
        { id: '1', name: 'build', path: '.gitea/workflows/build.yml', state: 'active' },
        { id: '2', name: 'deploy', path: '.gitea/workflows/deploy.yml', state: 'active' },
      ],
    },
  });
  tools = toV1Tools(repoTools({ ctx: ctxFor(host) })) as never;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(name: string, args: unknown = {}): Promise<string> {
  const out = await tools[name].execute(args, toolCtx);
  if (typeof out !== 'string') throw new Error(`${name} devolveu objeto, nao texto`);
  return out;
}

describe('repo_file', () => {
  it('le arquivo do repo', async () => {
    const out = await run('repo_file', {
      repo: REPO,
      path: '.gitea/workflows/build.yml',
      ref: 'main',
    });
    expect(out).toContain('.gitea/workflows/build.yml');
    expect(out).toContain('conteudo de');
  });
});

describe('repo_list', () => {
  it('lista repos da org', async () => {
    host.state.repos = [REPO, 'org/outro', 'org/terceiro'];
    const out = await run('repo_list');
    expect(out).toContain('org: 3 repo(s)');
    expect(out).toContain(REPO);
  });

  it('filtra por glob', async () => {
    host.state.repos = [REPO, 'org/api-core', 'org/api-web', 'org/frontend'];
    const out = await run('repo_list', { filter: 'api-*' });
    expect(out).toContain('api-core');
    expect(out).toContain('api-web');
    expect(out).not.toContain('frontend');
  });
});

describe('ci_config', () => {
  it('mostra variables, secrets e workflows, nunca o valor do secret', async () => {
    const out = await run('ci_config');
    expect(out).toContain('REGISTRY=registry.test');
    expect(out).toContain('SSH_KEYS=a b c');
    expect(out).toContain('DEPLOY_KEY');
    expect(out).toContain('TOKEN');
    expect(out).toContain('build');
  });

  it('repo sem CI diz que nao tem', async () => {
    host.state.actions = { variables: [], secrets: [], workflows: [] };
    const out = await run('ci_config');
    expect(out).toContain('(nenhuma)');
    expect(out).toContain('(nenhum)');
  });

  it('set_var cria variavel', async () => {
    const out = await run('ci_config', { action: 'set_var', name: 'NOVA_VAR', value: 'valor123' });
    expect(out).toContain('Variavel NOVA_VAR criada/atualizada');
    expect(host.called('upsertActionsVariable')[0]?.args).toEqual([REPO, 'NOVA_VAR', 'valor123']);
  });

  it('set_secret cria secret', async () => {
    const out = await run('ci_config', {
      action: 'set_secret',
      name: 'NOVO_SECRET',
      value: 'secret123',
    });
    expect(out).toContain('Secret NOVO_SECRET criado/atualizado');
    expect(host.called('upsertActionsSecret')[0]?.args).toEqual([REPO, 'NOVO_SECRET', 'secret123']);
  });

  it('del_var remove variavel', async () => {
    const out = await run('ci_config', { action: 'del_var', name: 'REGISTRY' });
    expect(out).toContain('Variavel REGISTRY removida');
    expect(host.called('deleteActionsVariable')[0]?.args).toEqual([REPO, 'REGISTRY']);
  });

  it('del_secret remove secret', async () => {
    const out = await run('ci_config', { action: 'del_secret', name: 'DEPLOY_KEY' });
    expect(out).toContain('Secret DEPLOY_KEY removido');
    expect(host.called('deleteActionsSecret')[0]?.args).toEqual([REPO, 'DEPLOY_KEY']);
  });

  it('action invalida e recusada', async () => {
    await expect(run('ci_config', { action: 'invalida' })).rejects.toThrow('Acao desconhecida');
  });
});
