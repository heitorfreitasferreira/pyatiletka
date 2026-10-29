import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBinding, writeBinding } from '../core/binding';
import { claudePid, currentSession, parentPid, trackSession } from './claude-session';

/**
 * O ponteiro `pid do claude -> sessao atual`. O hook grava, o servidor MCP le
 * subindo pelos pais. Os pais aqui sao uma tabela, sem processo de verdade.
 */

let dir: string;
let stateDir: string;

/** claude 100 -> npm exec 200 -> node 300 (o servidor MCP). */
const pais: Record<number, number> = { 300: 200, 200: 100, 100: 1 };
const parentOf = (pid: number): number | undefined => pais[pid];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-sess-'));
  stateDir = join(dir, 'estado');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('trackSession e currentSession', () => {
  it('sem ponteiro o servidor nao acha sessao', () => {
    expect(currentSession(dir, stateDir, 300, parentOf)).toBeUndefined();
  });

  it('o servidor acha a sessao gravada pelo hook no pid do claude', () => {
    trackSession(dir, stateDir, 100, 'ses_a');
    expect(currentSession(dir, stateDir, 300, parentOf)).toBe('ses_a');
  });

  it('depois de /clear o servidor ve a sessao nova', () => {
    trackSession(dir, stateDir, 100, 'ses_a');
    expect(trackSession(dir, stateDir, 100, 'ses_b')).toBe('ses_a');
    expect(currentSession(dir, stateDir, 300, parentOf)).toBe('ses_b');
  });

  it('o /clear leva o vinculo da sessao anterior', () => {
    trackSession(dir, stateDir, 100, 'ses_a');
    writeBinding(dir, 'ses_a', { repo: 'org/repo', issue: 7, boundAt: 't' }, stateDir);
    trackSession(dir, stateDir, 100, 'ses_b');
    expect(readBinding(dir, 'ses_b', stateDir)?.issue).toBe(7);
  });

  it('nao sobrescreve o vinculo que a sessao nova ja tem', () => {
    trackSession(dir, stateDir, 100, 'ses_a');
    writeBinding(dir, 'ses_a', { repo: 'org/repo', issue: 7, boundAt: 't' }, stateDir);
    writeBinding(dir, 'ses_b', { repo: 'org/repo', issue: 9, boundAt: 't' }, stateDir);
    trackSession(dir, stateDir, 100, 'ses_b');
    expect(readBinding(dir, 'ses_b', stateDir)?.issue).toBe(9);
  });

  it('outro claude no mesmo projeto tem a propria sessao', () => {
    trackSession(dir, stateDir, 100, 'ses_a');
    trackSession(dir, stateDir, 500, 'ses_x');
    const outro = (pid: number): number | undefined => ({ 700: 600, 600: 500 })[pid];
    expect(currentSession(dir, stateDir, 300, parentOf)).toBe('ses_a');
    expect(currentSession(dir, stateDir, 700, outro)).toBe('ses_x');
  });

  it('para de subir no init', () => {
    trackSession(dir, stateDir, 1, 'ses_init');
    expect(currentSession(dir, stateDir, 300, parentOf)).toBeUndefined();
  });
});

describe('parentPid', () => {
  it('le o pai deste processo', () => {
    expect(parentPid(process.pid)).toBe(process.ppid);
  });
});

describe('claudePid', () => {
  it('aceita so pid valido', () => {
    expect(claudePid({ CLAUDE_PID: '4242' })).toBe(4242);
    expect(claudePid({ CLAUDE_PID: 'x' })).toBeUndefined();
    expect(claudePid({ CLAUDE_PID: '1' })).toBeUndefined();
    expect(claudePid({})).toBeUndefined();
  });
});
