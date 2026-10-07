import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dotenvPaths, loadDotenv, parseDotenv, parseDotenvValue } from './dotenv';

describe('parseDotenvValue', () => {
  it('tira aspas simples e duplas', () => {
    expect(parseDotenvValue('"segredo"')).toBe('segredo');
    expect(parseDotenvValue("'segredo'")).toBe('segredo');
  });

  it('interpreta escapes entre aspas duplas', () => {
    expect(parseDotenvValue('"a\\nb"')).toBe('a\nb');
  });

  it('corta comentario no fim quando nao ha aspas', () => {
    expect(parseDotenvValue('segredo # nota')).toBe('segredo');
  });

  it('valor vazio vira string vazia', () => {
    expect(parseDotenvValue('')).toBe('');
  });
});

describe('parseDotenv', () => {
  it('le pares, export e ignora comentario e linha vazia', () => {
    const out = parseDotenv(
      ['# nota', '', 'export GITEA_TOKEN=abc', 'GITHUB_TOKEN = "ghp_x"', 'INVALIDO'].join('\n')
    );
    expect(out).toEqual({ GITEA_TOKEN: 'abc', GITHUB_TOKEN: 'ghp_x' });
  });
});

describe('dotenvPaths', () => {
  it('vai do global ao especifico e fecha com PYATILETKA_ENV_FILE', () => {
    const paths = dotenvPaths('/proj', {
      HOME: '/home/ana',
      XDG_CONFIG_HOME: '/cfg',
      PYATILETKA_ENV_FILE: '/tmp/extra.env',
    } as NodeJS.ProcessEnv);
    expect(paths).toEqual([
      '/cfg/pyatiletka/env',
      '/cfg/opencode/.env',
      '/proj/.env',
      '/tmp/extra.env',
    ]);
  });
});

describe('loadDotenv', () => {
  it('le o .env do projeto e o mais especifico sobrescreve no token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-env-'));
    try {
      const globalDir = join(dir, 'cfg', 'pyatiletka');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'env'), 'GITEA_TOKEN=global\nA=1\n');
      writeFileSync(join(dir, '.env'), 'GITEA_TOKEN=projeto\nB=2\n');

      const out = loadDotenv(dir, {
        HOME: join(dir, 'home'),
        XDG_CONFIG_HOME: join(dir, 'cfg'),
      } as NodeJS.ProcessEnv);

      expect(out.all.GITEA_TOKEN).toBe('projeto');
      expect(out.all.A).toBe('1');
      expect(out.all.B).toBe('2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('separa o confiavel do projeto, para o roteamento ignorar o clone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-env-'));
    try {
      const globalDir = join(dir, 'cfg', 'pyatiletka');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'env'), 'GITEA_URL=https://confiavel.example\nTOKEN_A=1\n');
      writeFileSync(join(dir, '.env'), 'GITEA_URL=https://do-repo.example\nTOKEN_B=2\n');

      const out = loadDotenv(dir, {
        HOME: join(dir, 'home'),
        XDG_CONFIG_HOME: join(dir, 'cfg'),
      } as NodeJS.ProcessEnv);

      expect(out.trusted.GITEA_URL).toBe('https://confiavel.example');
      expect(out.trusted.TOKEN_A).toBe('1');
      expect(out.project.GITEA_URL).toBe('https://do-repo.example');
      expect(out.project.TOKEN_B).toBe('2');
      expect(out.trusted.TOKEN_B).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
