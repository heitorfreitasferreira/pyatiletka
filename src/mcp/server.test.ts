import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_KEY, bindingFile } from '../core/binding';
import { toolName } from '../tools/spec';
import { createHandler } from './server';

/**
 * O adaptador do Claude Code liga as mesmas tools a um vinculo de workspace e a
 * um prefixo de nome. Sem host de rede aqui: `issue_unbind` so mexe no arquivo.
 */

let dir: string;
const stateDir = '.claude/.state/pyatiletka';

/** Ambiente limpo: nada de `.env` do usuario nem de CLI logada decidindo. */
const env = (): NodeJS.ProcessEnv => ({
  HOME: dir,
  XDG_CONFIG_HOME: join(dir, '.config'),
  CLAUDE_PROJECT_DIR: dir,
  PYATILETKA_AUTH: 'env',
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-mcp-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function bindWorkspace(): string {
  const file = bindingFile(dir, WORKSPACE_KEY, stateDir);
  mkdirSync(join(dir, stateDir), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ repo: 'org/repo', issue: 42, boundAt: '2026-10-19T00:00:00Z' })}\n`
  );
  return file;
}

describe('createHandler', () => {
  it('monta as 38 tools com o prefixo do plugin', () => {
    const { handler, ctx } = createHandler({ directory: dir, env: env() });
    expect(handler.specs).toHaveLength(38);
    expect(ctx.toolPrefix).toBe('mcp__plugin_pyatiletka_pyatiletka__');
    expect(ctx.stateDir).toBe(stateDir);
  });

  it('as instrucoes apontam a tool com o prefixo', () => {
    const { handler } = createHandler({ directory: dir, env: env() });
    expect(handler.instructions).toContain('mcp__plugin_pyatiletka_pyatiletka__issue_bind');
  });

  it('le o vinculo do workspace e desvincula pelo mesmo caminho', async () => {
    const file = bindWorkspace();
    const { handler } = createHandler({ directory: dir, env: env() });
    const unbind = handler.specs.find((s) => toolName(s) === 'issue_unbind');
    expect(unbind).toBeDefined();

    const out = await handler.run(unbind as never, {});
    expect(out).toContain('org/repo#42');
    expect(existsSync(file)).toBe(false);
  });

  it('cada sessao tem o proprio vinculo no mesmo projeto', async () => {
    const sessao = (id: string) =>
      createHandler({ directory: dir, env: { ...env(), CLAUDE_CODE_SESSION_ID: id } }).handler;
    const file = bindingFile(dir, 'ses_a', stateDir);
    mkdirSync(join(dir, stateDir), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ repo: 'org/repo', issue: 7, boundAt: 't' })}\n`);
    bindWorkspace();

    const ver = (h: ReturnType<typeof sessao>) =>
      h.run(h.specs.find((s) => toolName(s) === 'issue_binding') as never, {});
    expect(await ver(sessao('ses_b'))).toContain('Nenhuma issue vinculada');

    const a = sessao('ses_a');
    await a.run(a.specs.find((s) => toolName(s) === 'issue_unbind') as never, {});
    expect(existsSync(file)).toBe(false);
  });

  it('segue o ponteiro do hook em vez da sessao do spawn', async () => {
    const { trackSession } = await import('../adapters/claude-session');
    const pais: Record<number, number> = { 300: 200, 200: 100 };
    trackSession(dir, stateDir, 100, 'ses_nova');
    writeFileSync(
      bindingFile(dir, 'ses_nova', stateDir),
      `${JSON.stringify({ repo: 'org/repo', issue: 8, boundAt: 't' })}\n`
    );
    const { handler } = createHandler({
      directory: dir,
      env: { ...env(), CLAUDE_CODE_SESSION_ID: 'ses_spawn' },
      pid: 300,
      parentOf: (p) => pais[p],
    });
    const ver = handler.specs.find((s) => toolName(s) === 'issue_binding');
    expect(await handler.run(ver as never, {})).toContain('issue=8');
  });

  it('sem vinculo responde que nao ha nada', async () => {
    const { handler } = createHandler({ directory: dir, env: env() });
    const binding = handler.specs.find((s) => toolName(s) === 'issue_binding');
    const out = await handler.run(binding as never, {});
    expect(out).toContain('Nenhuma issue vinculada');
  });

  it('PYATILETKA_TOOL_PREFIX cobre o servidor declarado pelo usuario', () => {
    const { ctx } = createHandler({
      directory: dir,
      env: { ...env(), PYATILETKA_TOOL_PREFIX: 'mcp__pyatiletka__' },
    });
    expect(ctx.toolPrefix).toBe('mcp__pyatiletka__');
  });
});
