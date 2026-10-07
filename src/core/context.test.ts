import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCtx, matchGlob, normRepo, parseRef, parseRefs } from './context';
import type { Runner } from '../auth';

const noCli: Runner = () => ({ status: 127, stdout: '', stderr: '' });

describe('normRepo', () => {
  it('mantem owner/nome', () => {
    expect(normRepo('org/repo')).toBe('org/repo');
  });

  it('prefixa a org quando falta o owner', () => {
    expect(normRepo('repo', 'org')).toBe('org/repo');
  });

  it('tira barra das pontas, .git e espacos', () => {
    expect(normRepo('  org/repo.git/  ')).toBe('org/repo');
  });

  it('sem org e sem owner, explica o que falta', () => {
    expect(() => normRepo('repo')).toThrow(/PYATILETKA_ORG/);
  });
});

describe('parseRef', () => {
  it('aceita numero, string e #', () => {
    expect(parseRef(7)).toBe(7);
    expect(parseRef('7')).toBe(7);
    expect(parseRef('#77')).toBe(77);
  });

  it('vira NaN quando nao e numero', () => {
    expect(parseRef(undefined)).toBeNaN();
    expect(parseRef('abc')).toBeNaN();
  });
});

describe('parseRefs', () => {
  it('descarta o que nao for numero positivo', () => {
    expect(parseRefs(['#56', '57', 'abc', '0', '-3'])).toEqual([56, 57]);
  });

  it('lista vazia e undefined dao vazio', () => {
    expect(parseRefs()).toEqual([]);
    expect(parseRefs([])).toEqual([]);
  });
});

describe('matchGlob', () => {
  it('casa com * no meio e no fim', () => {
    expect(matchGlob('api-core', 'api-*')).toBe(true);
    expect(matchGlob('docs', 'api-*')).toBe(false);
    expect(matchGlob('build-cache', '*cache')).toBe(true);
  });

  it('trata os metacaracteres do padrao como literal', () => {
    expect(matchGlob('a.b', 'a.b')).toBe(true);
    expect(matchGlob('axb', 'a.b')).toBe(false);
  });

  it('ignora caixa', () => {
    expect(matchGlob('FRETE-API', 'frete-*')).toBe(true);
  });
});

describe('createCtx', () => {
  const withDir = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-ctx-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('sem credencial, o host explica o que falta na primeira chamada', () => {
    withDir((dir) => {
      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, '.config'),
          PYATILETKA_AUTH: 'env',
          PYATILETKA_PROVIDER: 'gitea',
          GITEA_URL: 'https://git.test',
        },
      });
      expect(ctx.config.provider).toBe('gitea');
      expect(ctx.config.token).toBe('');
      expect(ctx.config.authSource).toBe('none');
      expect(() => ctx.host.listRepos('org')).toThrow(/Sem credencial/);
    });
  });

  it('resolve o token do ambiente e cria o host de verdade', () => {
    withDir((dir) => {
      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, '.config'),
          PYATILETKA_AUTH: 'env',
          PYATILETKA_PROVIDER: 'gitea',
          GITEA_URL: 'https://git.test',
          GITEA_TOKEN: 'segredo',
        },
      });
      expect(ctx.config.token).toBe('segredo');
      expect(ctx.config.authSource).toBe('env');
      expect(ctx.host.provider).toBe('gitea');
    });
  });

  it('deriva org, repo e branch do clone', () => {
    withDir((dir) => {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
      spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/api.git'], {
        cwd: dir,
      });

      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, '.config'),
          PYATILETKA_AUTH: 'env',
          GITHUB_TOKEN: 't',
        },
      });

      expect(ctx.config.provider).toBe('github');
      expect(ctx.config.org).toBe('acme');
      expect(ctx.config.defaultRepo).toBe('acme/api');
      expect(ctx.config.defaultBranch).toBe('main');
    });
  });

  it('o ambiente vence a derivacao do clone', () => {
    withDir((dir) => {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
      spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/api.git'], {
        cwd: dir,
      });

      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, '.config'),
          PYATILETKA_AUTH: 'env',
          GITHUB_TOKEN: 't',
          PYATILETKA_ORG: 'outra',
          PYATILETKA_DEFAULT_BRANCH: 'develop',
        },
      });

      expect(ctx.config.org).toBe('outra');
      expect(ctx.config.defaultBranch).toBe('develop');
    });
  });
});

describe('createCtx: credencial e degradacao', () => {
  const withDir = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-ctx-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('sem provider nenhum ainda carrega e o host explica na chamada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-ctx-'));
    try {
      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: { HOME: dir, XDG_CONFIG_HOME: join(dir, '.config'), PYATILETKA_AUTH: 'env' },
      });
      expect(ctx.config.provider).toBeUndefined();
      expect(ctx.config.authSource).toBe('none');
      await expect(ctx.host.listRepos('org')).rejects.toThrow(/Nenhum provider/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('o host indisponivel rejeita, entao o .catch de degradacao funciona', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-ctx-'));
    try {
      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, '.config'),
          PYATILETKA_AUTH: 'env',
          PYATILETKA_PROVIDER: 'gitea',
          GITEA_URL: 'https://git.test',
        },
      });
      expect(ctx.config.token).toBe('');
      await expect(ctx.host.getRepo('org/repo').catch(() => 'sem-ci')).resolves.toBe('sem-ci');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('o .env do projeto nao troca a base, so o confiavel troca', () => {
    withDir((dir) => {
      writeFileSync(
        join(dir, '.env'),
        'GITHUB_API_URL=https://evil.example\nGITHUB_TOKEN=do-repo\n'
      );
      const homeEnv = join(dir, '.config', 'pyatiletka');
      mkdirSync(homeEnv, { recursive: true });
      writeFileSync(join(homeEnv, 'env'), 'GITHUB_API_URL=https://gh.corp/api/v3\n');

      const ctx = createCtx({
        directory: dir,
        client: {},
        run: noCli,
        env: {
          HOME: dir,
          XDG_CONFIG_HOME: join(dir, '.config'),
          PYATILETKA_AUTH: 'env',
          PYATILETKA_PROVIDER: 'github',
          GITHUB_TOKEN: 'do-ambiente',
        },
      });

      expect(ctx.config.baseUrl).toBe('https://gh.corp/api/v3');
      expect(ctx.config.host).toBe('gh.corp');
      expect(ctx.config.token).toBe('do-ambiente');
    });
  });
});
