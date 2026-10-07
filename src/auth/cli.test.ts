import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectProviderFromCli,
  ghToken,
  parseTeaLogins,
  teaConfigPaths,
  teaToken,
  teaTokenFromConfig,
  type RunResult,
  type Runner,
} from './cli';

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: '' });
const fail: RunResult = { status: 1, stdout: '', stderr: '' };

describe('ghToken', () => {
  it('devolve o token do gh logado', () => {
    const run: Runner = (cmd, args) =>
      cmd === 'gh' && args.includes('token') ? ok('ghp_x\n') : fail;
    expect(ghToken('github.com', run)).toBe('ghp_x');
  });

  it('ignora aviso de shim antes do token', () => {
    const run: Runner = (cmd, args) =>
      cmd === 'gh' && args.includes('token')
        ? ok('mise ~/.config/mise/config.toml tools: gh@2.102.0\nghp_x\n')
        : fail;
    expect(ghToken('github.com', run)).toBe('ghp_x');
  });

  it('sem login devolve undefined', () => {
    expect(ghToken('github.com', () => fail)).toBeUndefined();
  });
});

describe('parseTeaLogins', () => {
  it('le url, token e default', () => {
    const yaml = [
      'logins:',
      '    - name: work',
      '      url: https://git.corp',
      '      token: tok-work',
      '      default: true',
      '    - name: outro',
      '      url: https://outro.example',
      '      token: tok-outro',
    ].join('\n');
    const logins = parseTeaLogins(yaml);
    expect(logins).toHaveLength(2);
    expect(logins[0]).toEqual({ url: 'https://git.corp', token: 'tok-work', isDefault: true });
    expect(logins[1].token).toBe('tok-outro');
  });

  it('ignora entrada sem token', () => {
    const logins = parseTeaLogins('logins:\n    - name: x\n      url: https://x\n');
    expect(logins[0].token).toBeUndefined();
  });
});

describe('teaTokenFromConfig', () => {
  it('escolhe o login do host, preferindo o default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyatiletka-tea-'));
    try {
      const cfgDir = join(dir, 'tea');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, 'config.yml'),
        [
          'logins:',
          '    - name: a',
          '      url: https://git.corp',
          '      token: tok-a',
          '    - name: b',
          '      url: https://git.corp',
          '      token: tok-b',
          '      default: true',
        ].join('\n')
      );
      const env = { HOME: dir, XDG_CONFIG_HOME: dir } as NodeJS.ProcessEnv;
      expect(teaConfigPaths(env)[0]).toBe(join(cfgDir, 'config.yml'));
      expect(teaTokenFromConfig('git.corp', env)).toBe('tok-b');
      expect(teaTokenFromConfig('outro.example', env)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('usa o credential helper do tea quando responde', () => {
    const run: Runner = (cmd, args) =>
      cmd === 'tea' && args.join(' ').includes('helper get')
        ? ok('username=x\npassword=tok\n')
        : fail;
    expect(teaToken('git.corp', run, {} as NodeJS.ProcessEnv)).toBe('tok');
  });
});

describe('detectProviderFromCli', () => {
  it('escolhe o gh quando so ele responde', () => {
    const run: Runner = (cmd) => (cmd === 'gh' ? ok('') : fail);
    const env = { HOME: '/nada', XDG_CONFIG_HOME: '/nada' } as NodeJS.ProcessEnv;
    expect(detectProviderFromCli('github.com', run, env)).toBe('github');
  });

  it('sem CLI nenhuma devolve undefined', () => {
    const env = { HOME: '/nada', XDG_CONFIG_HOME: '/nada' } as NodeJS.ProcessEnv;
    expect(detectProviderFromCli(undefined, () => fail, env)).toBeUndefined();
  });
});
