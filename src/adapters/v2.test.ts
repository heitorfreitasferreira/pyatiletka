import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Plugin } from '@opencode/plugin';
import { registerHooks, setupV2 } from './v2';
import type { BindingStore } from '../core/binding';
import type { Ctx } from '../core/context';
import { TOOL_NAMES } from '../index';
import { FakeGitHost } from '../testing/fake-git-host';
import { FakePluginContext } from '../testing/fake-plugin-context';
import { makeConfig, makeIssue, REPO } from '../testing/fixtures';

/**
 * O adaptador v2 e testado com o `FakePluginContext`, que captura o que seria
 * registrado no host. Nenhuma chamada de rede: o host real so aparece se uma
 * tool for executada de verdade, o que os testes evitam.
 */

const ENV_KEYS = [
  'GITEA_URL',
  'GITEA_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_API_URL',
  'PYATILETKA_PROVIDER',
  'PYATILETKA_ORG',
  'PYATILETKA_PROSE',
  'PYATILETKA_DEFAULT_REPO',
  'PYATILETKA_PROMOTE_ORDER',
];

let plugin: FakePluginContext;
let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.GITEA_URL = 'https://gitea.test';
  process.env.GITEA_TOKEN = 'token-de-teste';
  process.env.PYATILETKA_ORG = 'org';
  plugin = new FakePluginContext();
});

afterEach(() => {
  process.env = saved;
});

const asV2 = () => plugin as unknown as Plugin.Context;

function coreCtx(host: FakeGitHost): Ctx {
  return { host, config: makeConfig(), remote: REPO, defaultRepo: REPO, notify: () => {} };
}

const boundTo = (issue: number): BindingStore => ({
  read: () => ({ repo: REPO, issue, boundAt: '2026-01-01T00:00:00Z' }),
  write: () => undefined,
  clear: () => true,
});

describe('setupV2', () => {
  it('registra as 36 tools com namespace por grupo, nomes iguais ao v1', async () => {
    await setupV2(asV2());
    const names = plugin.tools.map((t) => `${t.namespace}_${t.name}`).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it('declara um namespace para cada grupo', async () => {
    await setupV2(asV2());
    expect(new Set(plugin.namespaces.map((n) => n.name))).toEqual(
      new Set(['auth', 'issue', 'milestone', 'pr', 'ci', 'branch', 'commit'])
    );
  });

  it('cada tool tem input em JSON Schema de objeto', async () => {
    await setupV2(asV2());
    for (const t of plugin.tools) {
      expect(t.input.type, t.name).toBe('object');
      expect(t.input.properties, t.name).toBeDefined();
      expect(typeof t.description, t.name).toBe('string');
    }
  });

  it('o schema cobre os argumentos da tool', async () => {
    await setupV2(asV2());
    const bind = plugin.tools.find((t) => t.namespace === 'issue' && t.name === 'bind')!;
    const props = bind.input.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['issue', 'milestone', 'repo']);
  });

  it('execute roteia para o handler da spec', async () => {
    await setupV2(asV2());
    const unbind = plugin.tools.find((t) => t.namespace === 'issue' && t.name === 'unbind')!;
    const out = await unbind.execute(
      {},
      { sessionID: 'ses_1', signal: new AbortController().signal }
    );
    expect(out.content).toContain('ja estava desvinculada');
  });
});

describe('registerHooks v2', () => {
  it('context injeta o vinculo da sessao', async () => {
    const host = new FakeGitHost({ issues: [makeIssue({ number: 7, title: 'Fila do marco' })] });
    await registerHooks(asV2(), coreCtx(host), '/w', boundTo(7));

    const event = { sessionID: 'ses_1', system: [] as { type: string; text: string }[] };
    await plugin.sessionHooks.get('context')!(event);

    expect(event.system).toHaveLength(1);
    expect(event.system[0].text).toContain('org/repo#7');
    expect(event.system[0].text).toContain('Fila do marco');
  });

  it('context nao injeta nada sem vinculo', async () => {
    const semVinculo: BindingStore = {
      read: () => undefined,
      write: () => undefined,
      clear: () => true,
    };
    await registerHooks(asV2(), coreCtx(new FakeGitHost()), '/w', semVinculo);

    const event = { sessionID: 'ses_1', system: [] as { type: string; text: string }[] };
    await plugin.sessionHooks.get('context')!(event);
    expect(event.system).toHaveLength(0);
  });

  it('compaction preserva a referencia da issue', async () => {
    await registerHooks(asV2(), coreCtx(new FakeGitHost()), '/w', boundTo(7));

    const event = { sessionID: 'ses_1', system: [] as { type: string; text: string }[] };
    await plugin.sessionHooks.get('compaction')!(event);
    expect(event.system[0].text).toContain('issue_view');
    expect(event.system[0].text).toContain('org/repo#7');
  });

  it('execute.after ignora tool que nao seja push', async () => {
    await registerHooks(asV2(), coreCtx(new FakeGitHost()), '/w', boundTo(7));

    const event = {
      tool: 'read',
      status: 'completed',
      input: {},
      result: { content: 'original' },
    };
    await plugin.toolHooks.get('execute.after')!(event);
    expect(event.result.content).toBe('original');
  });
});
