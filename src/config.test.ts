import { describe, expect, it } from 'bun:test';
import { ConfigError, loadConfig, resolveProvider } from './config';

const gitea = { GITEA_URL: 'https://gitea.example.com/', GITEA_TOKEN: 't' };
const github = { GITHUB_TOKEN: 't' };

describe('resolveProvider', () => {
  it('usa PYATILETKA_PROVIDER quando presente', () => {
    expect(resolveProvider({ PYATILETKA_PROVIDER: 'github' }, 'gitea')).toBe('github');
  });

  it('cai no remote quando PYATILETKA_PROVIDER falta', () => {
    expect(resolveProvider({}, 'github')).toBe('github');
  });

  it('cai no ambiente quando nao ha remote', () => {
    expect(resolveProvider({ GITEA_URL: 'https://x' })).toBe('gitea');
    expect(resolveProvider({ GITHUB_TOKEN: 't' })).toBe('github');
  });

  it('reclama de valor invalido', () => {
    expect(() => resolveProvider({ PYATILETKA_PROVIDER: 'gitlab' })).toThrow(ConfigError);
  });
});

describe('loadConfig', () => {
  it('monta config do Gitea e normaliza a URL', () => {
    const c = loadConfig(gitea);
    expect(c.provider).toBe('gitea');
    expect(c.baseUrl).toBe('https://gitea.example.com');
    expect(c.prose).toBe('block');
  });

  it('monta config do GitHub com a URL padrao', () => {
    const c = loadConfig(github);
    expect(c.provider).toBe('github');
    expect(c.baseUrl).toBe('https://api.github.com');
  });

  it('GitHub Enterprise usa GITHUB_API_URL', () => {
    const c = loadConfig({ GITHUB_TOKEN: 't', GITHUB_API_URL: 'https://gh.corp/api/v3/' });
    expect(c.baseUrl).toBe('https://gh.corp/api/v3');
  });

  it('deriva org do PYATILETKA_DEFAULT_REPO', () => {
    const c = loadConfig({ ...github, PYATILETKA_DEFAULT_REPO: 'acme/repo' });
    expect(c.org).toBe('acme');
    expect(c.defaultRepo).toBe('acme/repo');
  });

  it('exige token', () => {
    expect(() => loadConfig({ GITEA_URL: 'https://x' })).toThrow(/GITEA_TOKEN/);
    expect(() => loadConfig({ PYATILETKA_PROVIDER: 'github' })).toThrow(/GITHUB_TOKEN/);
  });

  it('exige provider quando nada esta configurado', () => {
    expect(() => loadConfig({})).toThrow(/Nenhum provider/);
  });

  it('valida PYATILETKA_PROSE', () => {
    expect(loadConfig({ ...github, PYATILETKA_PROSE: 'warn' }).prose).toBe('warn');
    expect(() => loadConfig({ ...github, PYATILETKA_PROSE: 'nope' })).toThrow(/PYATILETKA_PROSE/);
  });
});

describe('readPromoteOrder', () => {
  it('padrao e staging -> production', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'x' }).promoteOrder).toEqual(['staging', 'production']);
  });

  it('PYATILETKA_PROMOTE_ORDER substitui, ignorando espacos', () => {
    const c = loadConfig({
      GITHUB_TOKEN: 'x',
      PYATILETKA_PROMOTE_ORDER: ' main , staging , prod ',
    });
    expect(c.promoteOrder).toEqual(['main', 'staging', 'prod']);
  });

  it('uma branch so nao vale como ordem', () => {
    expect(() => loadConfig({ GITHUB_TOKEN: 'x', PYATILETKA_PROMOTE_ORDER: 'main' })).toThrow(
      /PYATILETKA_PROMOTE_ORDER invalido/
    );
  });
});

describe('PYATILETKA_DEFAULT_BRANCH', () => {
  it('vira defaultBranch', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'x', PYATILETKA_DEFAULT_BRANCH: 'main' }).defaultBranch).toBe(
      'main'
    );
  });

  it('ausente fica vazio, para a tool pedir o valor em vez de adivinhar', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'x' }).defaultBranch).toBeUndefined();
  });
});
