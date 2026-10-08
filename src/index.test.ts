import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hooks } from '@opencode-ai/plugin';
import { createHooks, createTools, PyatiletkaPlugin, TOOL_NAMES } from './index';
import { readBinding, writeBinding } from './core/binding';
import type { Ctx } from './core/context';
import { FakeGitHost } from './testing/fake-git-host';
import { makeComment, makeConfig, makeIssue, REPO } from './testing/fixtures';

function ctxFor(f: FakeGitHost): Ctx {
  return {
    host: f,
    config: makeConfig(),
    remote: REPO,
    defaultRepo: REPO,
    notify: () => {},
  };
}

describe('TOOL_NAMES', () => {
  it('sao unicos', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });

  it('batem com o que createTools monta', () => {
    const tools = createTools(ctxFor(new FakeGitHost()), '/w');
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('cada tool tem descricao e execute', () => {
    const tools = createTools(ctxFor(new FakeGitHost()), '/w');
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof t.description, name).toBe('string');
      expect(typeof t.execute, name).toBe('function');
    }
  });
});

/**
 * O plugin le `process.env` na carga. Todo teste que carrega o plugin recebe
 * um ambiente limpo e so com o que precisa, para a maquina nao decidir o
 * provider.
 */
const ENV_KEYS = [
  'GITEA_URL',
  'GITEA_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_API_URL',
  'PYATILETKA_PROVIDER',
  'PYATILETKA_ORG',
  'PYATILETKA_PROSE',
  'PYATILETKA_DEFAULT_REPO',
  'PYATILETKA_AUTH',
  'PYATILETKA_ENV_FILE',
];

/**
 * O provider tambem vem do remote do clone, entao o diretorio precisa estar
 * fora de qualquer repo: em `/home/.../pyatiletka` o remote e GitHub e o
 * ambiente nem chega a ser consultado. `HOME` aponta para o temporario para os
 * `.env` globais do usuario nao entrarem no teste.
 */
async function loadPlugin(over: Record<string, string> = {}) {
  const saved = { ...process.env };
  const outside = mkdtempSync(join(tmpdir(), 'pyatiletka-fora-'));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(
    process.env,
    {
      HOME: outside,
      XDG_CONFIG_HOME: join(outside, '.config'),
      PYATILETKA_AUTH: 'env',
      GITEA_URL: 'https://gitea.test',
      GITEA_TOKEN: 'token-de-teste',
      PYATILETKA_ORG: 'org',
    },
    over
  );
  try {
    return (await PyatiletkaPlugin({
      directory: outside,
      client: {},
      worktree: outside,
    } as never)) as Hooks;
  } finally {
    rmSync(outside, { recursive: true, force: true });
    process.env = saved as NodeJS.ProcessEnv;
  }
}

describe('PyatiletkaPlugin', () => {
  it('default export serve v1 (server) e v2 (setup)', async () => {
    const mod = await import('./index');
    expect(mod.default.server).toBe(mod.PyatiletkaPlugin);
    expect(typeof mod.default.setup).toBe('function');
    expect(mod.default.id).toBe('pyatiletka');
  });

  it('devolve as tools e os tres hooks', async () => {
    const hooks = await loadPlugin();
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...TOOL_NAMES].sort());
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function');
    expect(typeof hooks['experimental.session.compacting']).toBe('function');
    expect(typeof hooks['tool.execute.after']).toBe('function');
  });

  it('sem provider nao derruba a carga: as tools de credencial sobram', async () => {
    const hooks = await loadPlugin({ GITEA_URL: '', GITEA_TOKEN: '' });
    expect(Object.keys(hooks.tool ?? {})).toContain('auth_login');
    expect(Object.keys(hooks.tool ?? {})).toContain('auth_status');
  });

  it('sem token nao derruba a carga: o host falha so quando usado', async () => {
    await expect(loadPlugin({ GITEA_TOKEN: '' })).resolves.toBeDefined();
  });

  it('pe o provider do ambiente quando PYATILETKA_PROVIDER manda', async () => {
    await expect(loadPlugin({ PYATILETKA_PROVIDER: 'gitea' })).resolves.toBeDefined();
  });
});

/**
 * O loader de plugin npm resolve o entrypoint `server` por `exports["./server"]`
 * e, sem ele, por `package.json main`. Sem os dois o pacote e ignorado em
 * silencio, entao os campos ficam presos por teste.
 */
describe('entrada do pacote', () => {
  it('expoe o mesmo arquivo em main e exports["./server"]', async () => {
    const pkg = (await import('../package.json')).default;
    expect(pkg.main).toBe('./dist/index.js');
    expect(pkg.exports['./server'].default).toBe('./dist/index.js');
  });
});

describe('hooks de contexto', () => {
  let dir: string;
  let host: FakeGitHost;
  let hooks: Hooks;

  const load = () => void (hooks = createHooks(ctxFor(host), dir));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pyatiletka-index-'));
    host = new FakeGitHost({
      issues: [
        makeIssue({
          number: 7,
          title: 'Corrigir a fila',
          body: '## Objetivo\n\na fila para de travar',
          labels: ['Status/In Progress'],
          milestone: { id: 3, title: 'Entrega' },
          comments: 2,
        }),
      ],
      comments: {
        7: [
          makeComment({ id: 1, body: 'primeiro bloco' }),
          makeComment({ id: 2, body: 'segundo bloco' }),
        ],
      },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sem vinculo, nao injeta nada no system', async () => {
    load();
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']?.(
      { sessionID: 'ses_1', model: {} as never },
      output
    );
    expect(output.system).toEqual([]);
  });

  it('com vinculo, injeta o corpo, as labels e os comentarios', async () => {
    writeBinding(dir, 'ses_1', { repo: REPO, issue: 7, milestone: 'Entrega', boundAt: 'x' });
    load();
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']?.(
      { sessionID: 'ses_1', model: {} as never },
      output
    );
    const head = output.system.join('\n');
    expect(head).toContain('org/repo#7');
    expect(head).toContain('marco/epico: Entrega');
    expect(head).toContain('#7 [open] Corrigir a fila');
    expect(head).toContain('a fila para de travar');
    expect(head).toContain('labels: Status/In Progress');
    expect(head).toContain('primeiro bloco');
    expect(head).toContain('segundo bloco');
  });

  it('falha ao ler a issue vira aviso, nao turno quebrado', async () => {
    writeBinding(dir, 'ses_1', { repo: REPO, issue: 7, boundAt: 'x' });
    load();
    host.fail.set('getIssue', new Error('500 do servidor'));
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']?.(
      { sessionID: 'ses_1', model: {} as never },
      output
    );
    expect(output.system.join('\n')).toContain('Falha ao ler a issue: 500 do servidor');
  });

  it('avisa quando a API corta comentarios', async () => {
    writeBinding(dir, 'ses_1', { repo: REPO, issue: 7, boundAt: 'x' });
    load();
    host.state.comments[7] = [makeComment({ id: 1, body: 'so este' })];
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']?.(
      { sessionID: 'ses_1', model: {} as never },
      output
    );
    expect(output.system.join('\n')).toContain('a API devolveu 1 de 2 comentarios');
  });

  it('compacting preserva o vinculo', async () => {
    writeBinding(dir, 'ses_1', { repo: REPO, issue: 7, milestone: 'Entrega', boundAt: 'x' });
    load();
    const output = { context: [] as string[] };
    await hooks['experimental.session.compacting']?.({ sessionID: 'ses_1' }, output);
    expect(output.context.join('\n')).toContain('org/repo#7');
    expect(output.context.join('\n')).toContain('issue_view');
  });

  it('compacting sem vinculo nao adiciona nada', async () => {
    load();
    const output = { context: [] as string[] };
    await hooks['experimental.session.compacting']?.({ sessionID: 'ses_1' }, output);
    expect(output.context).toEqual([]);
  });

  it('o vinculo gravado pela tool e o mesmo que o hook le', async () => {
    writeBinding(dir, 'ses_9', { repo: REPO, issue: 7, boundAt: 'x' });
    expect(readBinding(dir, 'ses_9')?.issue).toBe(7);
  });
});
