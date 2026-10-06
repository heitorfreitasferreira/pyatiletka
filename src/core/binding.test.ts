import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindingFile, clearBinding, readBinding, writeBinding, type Binding } from './binding';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-bind-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bindingFile', () => {
  it('vive em .opencode/.state/issue-sessions, nomeado pela sessao', () => {
    expect(bindingFile('/w', 'ses_1')).toBe('/w/.opencode/.state/issue-sessions/ses_1.json');
  });
});

describe('writeBinding e readBinding', () => {
  const b: Binding = {
    repo: 'org/repo',
    issue: 42,
    milestone: 'Entrega',
    boundAt: '2026-01-01T00:00:00Z',
  };

  it('faz a ida e a volta, criando o diretorio', () => {
    const f = writeBinding(dir, 'ses_1', b);
    expect(f).toBe(bindingFile(dir, 'ses_1'));
    expect(readBinding(dir, 'ses_1')).toEqual(b);
  });

  it('sobrescreve o vinculo anterior', () => {
    writeBinding(dir, 'ses_1', b);
    writeBinding(dir, 'ses_1', { repo: 'outro/repo', boundAt: '2026-02-02T00:00:00Z' });
    expect(readBinding(dir, 'ses_1')).toEqual({
      repo: 'outro/repo',
      boundAt: '2026-02-02T00:00:00Z',
    });
  });

  it('um arquivo por sessao', () => {
    writeBinding(dir, 'ses_1', b);
    writeBinding(dir, 'ses_2', { ...b, issue: 43 });
    expect(readBinding(dir, 'ses_1')?.issue).toBe(42);
    expect(readBinding(dir, 'ses_2')?.issue).toBe(43);
  });

  it('devolve undefined sem arquivo', () => {
    expect(readBinding(dir, 'nao_existe')).toBeUndefined();
  });

  it('JSON invalido devolve undefined em vez de estourar', () => {
    const f = bindingFile(dir, 'ses_1');
    mkdirSync(join(dir, '.opencode/.state/issue-sessions'), { recursive: true });
    writeFileSync(f, '{ nao e json');
    expect(readBinding(dir, 'ses_1')).toBeUndefined();
  });

  it('JSON sem repo devolve undefined', () => {
    const f = bindingFile(dir, 'ses_1');
    mkdirSync(join(dir, '.opencode/.state/issue-sessions'), { recursive: true });
    writeFileSync(f, '{"issue": 1}');
    expect(readBinding(dir, 'ses_1')).toBeUndefined();
  });
});

describe('clearBinding', () => {
  it('apaga o arquivo e diz se havia', () => {
    writeBinding(dir, 'ses_1', { repo: 'org/repo', boundAt: '2026-01-01T00:00:00Z' });
    expect(clearBinding(dir, 'ses_1')).toBe(true);
    expect(readBinding(dir, 'ses_1')).toBeUndefined();
    expect(clearBinding(dir, 'ses_1')).toBe(false);
  });
});
