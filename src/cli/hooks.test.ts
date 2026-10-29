import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_KEY, writeBinding } from '../core/binding';
import type { Ctx } from '../core/context';
import type { Run } from '../providers/types';
import { FakeGitHost } from '../testing/fake-git-host';
import { makeComment, makeConfig, makeIssue, REPO } from '../testing/fixtures';
import { contextHook, pushHook } from './hooks';

/** Prefixo que o Claude Code da as tools de um servidor embutido no plugin. */
const PREFIX = 'mcp__plugin_pyatiletka_pyatiletka__';

let dir: string;
let stateDir: string;
let host: FakeGitHost;

function ctxFor(f: FakeGitHost): Ctx {
  return {
    host: f,
    config: makeConfig(),
    remote: REPO,
    defaultRepo: REPO,
    toolPrefix: PREFIX,
    notify: () => {},
  };
}

const run1 = (over: Partial<Run> = {}): Run => ({
  id: 100,
  status: 'completed',
  conclusion: 'success',
  branch: 'main',
  sha: 'aaaa1111',
  title: 'build da main',
  path: '.github/workflows/build.yml',
  event: 'push',
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-hook-'));
  stateDir = join(dir, '.claude', '.state', 'pyatiletka');
  host = new FakeGitHost({
    issues: [
      makeIssue({
        number: 7,
        title: 'Corrigir a fila',
        body: '## Objetivo\n\na fila para de travar',
        labels: ['Status/In Progress'],
      }),
    ],
    comments: { 7: [makeComment({ id: 1, body: 'primeiro bloco' })] },
    runs: [run1()],
    actions: { variables: [], secrets: [], workflows: [{ id: 'build', name: 'Build' }] },
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const deps = () => ({ ctx: ctxFor(host), cwd: dir, stateDir, env: {} });

/** Vinculo do workspace, com o carimbo de tempo que o tipo exige. */
const bind = (over: { repo: string; issue?: number; milestone?: string }): void => {
  writeBinding(dir, WORKSPACE_KEY, { ...over, boundAt: '2026-10-19T00:00:00Z' }, stateDir);
};

describe('contextHook', () => {
  it('sem vinculo nao devolve nada', async () => {
    expect(await contextHook({ hook_event_name: 'SessionStart' }, deps())).toBeUndefined();
  });

  it('injeta o corpo, as labels e os comentarios', async () => {
    bind({ repo: REPO, issue: 7, milestone: 'Entrega' });
    const out = await contextHook({ hook_event_name: 'SessionStart' }, deps());
    const text = out?.hookSpecificOutput.additionalContext ?? '';
    expect(out?.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(text).toContain('org/repo#7');
    expect(text).toContain('marco/epico: Entrega');
    expect(text).toContain('a fila para de travar');
    expect(text).toContain('labels: Status/In Progress');
    expect(text).toContain('primeiro bloco');
  });

  it('aponta a tool com o prefixo do host', async () => {
    bind({ repo: REPO, issue: 7 });
    const out = await contextHook({ hook_event_name: 'UserPromptSubmit' }, deps());
    const text = out?.hookSpecificOutput.additionalContext ?? '';
    expect(text).toContain(`${PREFIX}issue_comment`);
    expect(text).toContain(`${PREFIX}issue_create`);
    expect(text).not.toContain('`issue_comment`');
  });

  it('le o vinculo pela raiz do projeto quando o evento vem de uma subpasta', async () => {
    bind({ repo: REPO, issue: 7 });
    const out = await contextHook(
      { hook_event_name: 'UserPromptSubmit', cwd: join(dir, 'apps') },
      { ctx: ctxFor(host), stateDir, env: { CLAUDE_PROJECT_DIR: dir } }
    );
    expect(out?.hookSpecificOutput.additionalContext).toContain('org/repo#7');
  });

  it('cada projeto le o proprio vinculo com o estado do plugin', async () => {
    const pluginState = join(dir, 'plugin-data', 'state');
    const outro = join(dir, 'outro-projeto');
    writeBinding(dir, WORKSPACE_KEY, { repo: REPO, issue: 7, boundAt: 't' }, pluginState);
    const deps2 = (projectDir: string) => ({
      ctx: ctxFor(host),
      stateDir: pluginState,
      env: { CLAUDE_PROJECT_DIR: projectDir },
    });
    expect(await contextHook({}, deps2(dir))).toBeDefined();
    expect(await contextHook({}, deps2(outro))).toBeUndefined();
  });

  it('cada sessao le o proprio vinculo', async () => {
    writeBinding(dir, 'ses_a', { repo: REPO, issue: 7, boundAt: 't' }, stateDir);
    bind({ repo: REPO, issue: 9 });
    const sessao = (id: string) => ({
      ctx: ctxFor(host),
      cwd: dir,
      stateDir,
      env: { CLAUDE_CODE_SESSION_ID: id },
    });
    const a = await contextHook({ session_id: 'ses_a' }, sessao('ses_a'));
    expect(a?.hookSpecificOutput.additionalContext).toContain('org/repo#7');
    expect(await contextHook({ session_id: 'ses_b' }, sessao('ses_b'))).toBeUndefined();
  });

  it('depois de /clear le pelo stdin e leva o vinculo para a sessao nova', async () => {
    writeBinding(dir, 'ses_a', { repo: REPO, issue: 7, boundAt: 't' }, stateDir);
    // O ambiente do processo ainda diz ses_a, o stdin ja diz ses_b.
    const d = {
      ctx: ctxFor(host),
      cwd: dir,
      stateDir,
      env: { CLAUDE_CODE_SESSION_ID: 'ses_a', CLAUDE_PID: '4242' },
    };
    await contextHook({ session_id: 'ses_a', source: 'startup' }, d);
    const out = await contextHook({ session_id: 'ses_b', source: 'clear' }, d);
    expect(out?.hookSpecificOutput.additionalContext).toContain('org/repo#7');
  });

  it('falha ao ler a issue vira aviso, nao excecao', async () => {
    bind({ repo: REPO, issue: 7 });
    host.fail.set('getIssue', new Error('500 do servidor'));
    const out = await contextHook({}, deps());
    expect(out?.hookSpecificOutput.additionalContext).toContain('Falha ao ler a issue: 500');
  });
});

describe('pushHook', () => {
  it('ignora push de teste ou forcado', async () => {
    const input = { hook_event_name: 'PostToolUse', tool_name: 'Bash' };
    const out = await pushHook(
      { ...input, tool_input: { command: 'git push --dry-run origin main' } },
      deps()
    );
    expect(out).toBeUndefined();
  });

  it('ignora comando que nao e push', async () => {
    const out = await pushHook(
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' } },
      deps()
    );
    expect(out).toBeUndefined();
  });

  it('ignora tool que nao e Bash', async () => {
    const out = await pushHook(
      { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { command: 'git push' } },
      deps()
    );
    expect(out).toBeUndefined();
  });

  it('repo sem workflow nao espera CI', async () => {
    host.state.actions = { variables: [], secrets: [], workflows: [] };
    const out = await pushHook(
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } },
      deps()
    );
    expect(out).toBeUndefined();
  });

  it('push verde volta como additionalContext', async () => {
    const out = await pushHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
      },
      deps()
    );
    const text = out?.hookSpecificOutput.additionalContext ?? '';
    expect(text).toContain('verde: o push foi confirmado pelo CI');
    expect(out?.hookSpecificOutput.hookEventName).toBe('PostToolUse');
  });

  it('CI vermelho traz o veredito e o apontamento do log', async () => {
    host.state.runs = [run1({ conclusion: 'failure', status: 'completed' })];
    host.state.runLogs = { 100: 'Job: test (ID: 3)\nerror: 3 tests failed' };
    const out = await pushHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
      },
      deps()
    );
    const text = out?.hookSpecificOutput.additionalContext ?? '';
    expect(text).toContain('NAO passou pelo CI');
    expect(text).toContain('error: 3 tests failed');
  });

  it('falha sem linha de erro aponta a tool de log, com prefixo', async () => {
    host.state.runs = [run1({ conclusion: 'failure', status: 'completed' })];
    host.state.runLogs = { 100: 'nada de util aqui' };
    const out = await pushHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git push origin main' },
      },
      deps()
    );
    expect(out?.hookSpecificOutput.additionalContext).toContain(`${PREFIX}ci_logs`);
  });
});
