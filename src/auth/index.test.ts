import { describe, expect, it } from 'bun:test';
import { ConfigError } from '../config';
import {
  credentialEnvKeys,
  missingCredentialMessage,
  readAuthMode,
  resolveAuth,
  type ResolveAuthInput,
} from './index';
import type { RunResult, Runner } from './cli';

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: '' });
const fail: RunResult = { status: 1, stdout: '', stderr: '' };
const noCli: Runner = () => fail;

const base: ResolveAuthInput = {
  provider: 'gitea',
  host: 'git.test',
  env: {},
  fileEnv: {},
  run: noCli,
};

describe('readAuthMode', () => {
  it('padrao e auto', () => {
    expect(readAuthMode({})).toBe('auto');
  });

  it('aceita as tres opcoes', () => {
    expect(readAuthMode({ PYATILETKA_AUTH: 'env' })).toBe('env');
    expect(readAuthMode({ PYATILETKA_AUTH: 'CLI' })).toBe('cli');
  });

  it('reclama de valor invalido', () => {
    expect(() => readAuthMode({ PYATILETKA_AUTH: 'x' })).toThrow(ConfigError);
  });
});

describe('resolveAuth', () => {
  it('o ambiente vence o .env e a CLI', () => {
    const run: Runner = () => ok('do-gh\n');
    const r = resolveAuth({
      ...base,
      provider: 'github',
      env: { GITHUB_TOKEN: 'do-env' },
      fileEnv: { GITHUB_TOKEN: 'do-arquivo' },
      run,
    });
    expect(r).toEqual({ token: 'do-env', source: 'env' });
  });

  it('sem ambiente, o .env vence a CLI', () => {
    const run: Runner = () => ok('do-gh\n');
    const r = resolveAuth({
      ...base,
      provider: 'github',
      fileEnv: { GITHUB_TOKEN: 'do-arquivo' },
      run,
    });
    expect(r).toEqual({ token: 'do-arquivo', source: 'dotenv' });
  });

  it('cai no gh quando nao ha ambiente nem .env', () => {
    const run: Runner = (cmd, args) =>
      cmd === 'gh' && args.includes('token') ? ok('ghp_x\n') : fail;
    const r = resolveAuth({ ...base, provider: 'github', run });
    expect(r).toEqual({ token: 'ghp_x', source: 'gh' });
  });

  it('cai no tea para o gitea', () => {
    const run: Runner = (cmd, args) =>
      cmd === 'tea' && args.join(' ').includes('helper get') ? ok('password=tok\n') : fail;
    const r = resolveAuth({ ...base, run, env: { HOME: '/nada', XDG_CONFIG_HOME: '/nada' } });
    expect(r).toEqual({ token: 'tok', source: 'tea' });
  });

  it('modo env ignora a CLI', () => {
    const run: Runner = () => ok('do-gh\n');
    const r = resolveAuth({ ...base, provider: 'github', run, mode: 'env' });
    expect(r).toEqual({ token: '', source: 'none' });
  });

  it('modo cli ignora o ambiente', () => {
    const run: Runner = () => ok('ghp_x\n');
    const r = resolveAuth({
      ...base,
      provider: 'github',
      env: { GITHUB_TOKEN: 'do-env' },
      run,
      mode: 'cli',
    });
    expect(r).toEqual({ token: 'ghp_x', source: 'gh' });
  });
});

describe('credentialEnvKeys', () => {
  it('github aceita GH_TOKEN como alternativa', () => {
    expect(credentialEnvKeys('github')).toEqual(['GITHUB_TOKEN', 'GH_TOKEN']);
    expect(credentialEnvKeys('gitea')).toEqual(['GITEA_TOKEN']);
  });
});

describe('missingCredentialMessage', () => {
  it('cita a variavel e o comando de login', () => {
    const msg = missingCredentialMessage({ provider: 'github', host: 'github.com' });
    expect(msg).toContain('GITHUB_TOKEN');
    expect(msg).toContain('gh auth login');
  });
});
