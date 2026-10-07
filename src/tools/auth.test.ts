import { describe, expect, it } from 'bun:test';
import type { ToolContext } from '@opencode-ai/plugin';
import { toV1Tools } from '../adapters/v1';
import type { Runner } from '../auth';
import type { Ctx } from '../core/context';
import { FakeGitHost } from '../testing/fake-git-host';
import { makeConfig } from '../testing/fixtures';
import { authTools } from './auth';

const noCli: Runner = () => ({ status: 127, stdout: '', stderr: '' });
const ghOk: Runner = (cmd) =>
  cmd === 'gh' ? { status: 0, stdout: '', stderr: '' } : { status: 127, stdout: '', stderr: '' };

const toolCtx = {} as unknown as ToolContext;

function ctxFor(over: Partial<Ctx['config']> = {}, run: Runner = noCli): Ctx {
  return {
    host: new FakeGitHost(),
    config: makeConfig(over),
    remote: 'org/repo',
    defaultRepo: 'org/repo',
    run,
    notify: () => {},
  };
}

const run = async (name: string, ctx: Ctx): Promise<string> =>
  (await toV1Tools(authTools({ ctx }))[name].execute({}, toolCtx)) as string;

describe('auth_status', () => {
  it('mostra a config derivada e a origem da credencial', async () => {
    const ctx = ctxFor({
      org: 'acme',
      defaultRepo: 'acme/api',
      defaultBranch: 'main',
      authSource: 'gh',
    });
    const out = await run('auth_status', ctx);
    expect(out).toContain('org: acme');
    expect(out).toContain('repo padrao: acme/api');
    expect(out).toContain('branch padrao: main');
    expect(out).toContain('login do gh');
  });

  it('sem credencial, explica o que fazer', async () => {
    const ctx = ctxFor({ token: '', authSource: 'none' });
    expect(await run('auth_status', ctx)).toContain('Sem credencial');
  });
});

describe('auth_login', () => {
  it('github com gh instalado sugere o login no navegador', async () => {
    const ctx = ctxFor(
      { provider: 'github', host: 'github.com', token: '', authSource: 'none' },
      ghOk
    );
    expect(await run('auth_login', ctx)).toContain('gh auth login --hostname github.com --web');
  });

  it('gitea sem tea sugere a variavel GITEA_TOKEN', async () => {
    const ctx = ctxFor({ provider: 'gitea', token: '', authSource: 'none' });
    expect(await run('auth_login', ctx)).toContain('GITEA_TOKEN');
  });
});
