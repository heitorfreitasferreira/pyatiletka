import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { HELP, runCli, type CliIo } from './run';

/**
 * O binario tem duas responsabilidades: nao sujar o stdout do MCP e nunca
 * derrubar a sessao por causa de um hook.
 */

let dir: string;

/** Ambiente limpo: sem .env do usuario e sem gh/tea decidindo o provider. */
function envFor(): NodeJS.ProcessEnv {
  return {
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, '.config'),
    CLAUDE_PROJECT_DIR: dir,
    PYATILETKA_AUTH: 'env',
  };
}

function ioFor(stdin = ''): CliIo & { lines: string[]; errs: string[] } {
  const lines: string[] = [];
  const errs: string[] = [];
  return {
    lines,
    errs,
    input: Readable.from(stdin ? [stdin] : []),
    output: { write: (chunk: string) => void lines.push(chunk) },
    err: { write: (chunk: string) => void errs.push(chunk) },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runCli', () => {
  it('sem argumento mostra a ajuda', async () => {
    const io = ioFor();
    expect(await runCli([], io)).toBe(0);
    expect(io.lines.join('')).toBe(HELP);
  });

  it('--version imprime a versao e sai 0', async () => {
    const io = ioFor();
    expect(await runCli(['--version'], io)).toBe(0);
    expect(io.lines.join('')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('comando desconhecido sai 1 e explica no stderr', async () => {
    const io = ioFor();
    expect(await runCli(['varrer'], io)).toBe(1);
    expect(io.errs.join('')).toContain('varrer');
  });

  it('hook desconhecido sai 1', async () => {
    const io = ioFor();
    expect(await runCli(['hook', 'compilar'], io, envFor())).toBe(1);
    expect(io.errs.join('')).toContain('compilar');
  });

  it('hook context sem vinculo nao escreve nada e sai 0', async () => {
    const io = ioFor(JSON.stringify({ hook_event_name: 'SessionStart', cwd: dir }));
    expect(await runCli(['hook', 'context'], io, envFor())).toBe(0);
    expect(io.lines).toEqual([]);
    expect(io.errs).toEqual([]);
  });

  it('hook context com stdin ilegivel avisa e sai 0', async () => {
    const io = ioFor('isso nao e json');
    expect(await runCli(['hook', 'context'], io, envFor())).toBe(0);
    expect(io.errs.join('')).toContain('nao e JSON');
  });

  it('mcp com stdin fechado termina sem escrever no stdout', async () => {
    const io = ioFor();
    expect(await runCli(['mcp'], io, envFor())).toBe(0);
    expect(io.lines).toEqual([]);
  });

  it('mcp responde o initialize e ignora linha vazia', async () => {
    const io = ioFor(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n\n`
    );
    expect(await runCli(['mcp'], io, envFor())).toBe(0);
    const responses = io.lines.join('').trim().split('\n').filter(Boolean);
    expect(responses).toHaveLength(1);
    expect(JSON.parse(responses[0] as string).result.serverInfo.name).toBe('pyatiletka');
  });
});
