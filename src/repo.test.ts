import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProvider, localDefaultBranch, parseRemote, resolveRepoFromRemote } from './repo';

describe('parseRemote', () => {
  it('le HTTPS do GitHub', () => {
    expect(parseRemote('https://github.com/acme/repo.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('le HTTPS sem .git', () => {
    expect(parseRemote('https://github.com/acme/repo')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('le scp-like', () => {
    expect(parseRemote('git@github.com:acme/repo.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('le ssh com porta', () => {
    expect(parseRemote('ssh://git@gitea.example.com:2222/acme/repo.git')).toEqual({
      host: 'gitea.example.com',
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('le Gitea com subpath de host', () => {
    expect(parseRemote('https://git.empresa.com.br/acme/repo.git')).toEqual({
      host: 'git.empresa.com.br',
      owner: 'acme',
      repo: 'repo',
    });
  });

  it('ignora valor vazio ou invalido', () => {
    expect(parseRemote('')).toBeUndefined();
    expect(parseRemote('nao e url')).toBeUndefined();
  });
});

describe('detectProvider', () => {
  it('github.com e subdominios viram github', () => {
    expect(detectProvider('github.com')).toBe('github');
    expect(detectProvider('ghe.corp.github.com')).toBe('github');
  });

  it('qualquer outro host vira gitea', () => {
    expect(detectProvider('gitea.example.com')).toBe('gitea');
    expect(detectProvider('git.empresa.com.br')).toBe('gitea');
  });
});

describe('resolveRepoFromRemote', () => {
  it('junta provider e slug', () => {
    expect(resolveRepoFromRemote('git@github.com:acme/repo.git')).toEqual({
      provider: 'github',
      slug: 'acme/repo',
      host: 'github.com',
    });
  });

  it('devolve undefined sem remote', () => {
    expect(resolveRepoFromRemote(undefined)).toBeUndefined();
  });
});

describe('localDefaultBranch', () => {
  const withDir = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-branch-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('sem repo devolve undefined', () => {
    withDir((dir) => {
      expect(localDefaultBranch(dir)).toBeUndefined();
    });
  });

  it('usa a branch atual quando nao ha origin/HEAD', () => {
    withDir((dir) => {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/trunk'], { cwd: dir });
      expect(localDefaultBranch(dir)).toBe('trunk');
    });
  });
});
