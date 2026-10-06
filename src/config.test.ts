import { describe, expect, it } from 'bun:test';
import { ConfigError, loadConfig, resolveProvider } from './config';

const gitea = { GITEA_URL: 'https://gitea.example.com/', GITEA_TOKEN: 't' };
const github = { GITHUB_TOKEN: 't' };

describe('resolveProvider', () => {
  it('usa FORGE_PROVIDER quando presente', () => {
    expect(resolveProvider({ FORGE_PROVIDER: 'github' }, 'gitea')).toBe('github');
  });

  it('cai no remote quando FORGE_PROVIDER falta', () => {
    expect(resolveProvider({}, 'github')).toBe('github');
  });

  it('cai no ambiente quando nao ha remote', () => {
    expect(resolveProvider({ GITEA_URL: 'https://x' })).toBe('gitea');
    expect(resolveProvider({ GITHUB_TOKEN: 't' })).toBe('github');
  });

  it('reclama de valor invalido', () => {
    expect(() => resolveProvider({ FORGE_PROVIDER: 'gitlab' })).toThrow(ConfigError);
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

  it('deriva org do FORGE_DEFAULT_REPO', () => {
    const c = loadConfig({ ...github, FORGE_DEFAULT_REPO: 'acme/repo' });
    expect(c.org).toBe('acme');
    expect(c.defaultRepo).toBe('acme/repo');
  });

  it('exige token', () => {
    expect(() => loadConfig({ GITEA_URL: 'https://x' })).toThrow(/GITEA_TOKEN/);
    expect(() => loadConfig({ FORGE_PROVIDER: 'github' })).toThrow(/GITHUB_TOKEN/);
  });

  it('exige provider quando nada esta configurado', () => {
    expect(() => loadConfig({})).toThrow(/Nenhum provider/);
  });

  it('valida FORGE_PROSE', () => {
    expect(loadConfig({ ...github, FORGE_PROSE: 'warn' }).prose).toBe('warn');
    expect(() => loadConfig({ ...github, FORGE_PROSE: 'nope' })).toThrow(/FORGE_PROSE/);
  });
});

describe('readPromoteOrder', () => {
  it('padrao e staging -> production', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'x' }).promoteOrder).toEqual(['staging', 'production']);
  });

  it('FORGE_PROMOTE_ORDER substitui, ignorando espacos', () => {
    const c = loadConfig({ GITHUB_TOKEN: 'x', FORGE_PROMOTE_ORDER: ' main , staging , prod ' });
    expect(c.promoteOrder).toEqual(['main', 'staging', 'prod']);
  });

  it('uma branch so nao vale como ordem', () => {
    expect(() => loadConfig({ GITHUB_TOKEN: 'x', FORGE_PROMOTE_ORDER: 'main' })).toThrow(
      /FORGE_PROMOTE_ORDER invalido/
    );
  });
});

describe('FORGE_DEFAULT_BRANCH', () => {
  it('vira defaultBranch', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'x', FORGE_DEFAULT_BRANCH: 'main' }).defaultBranch).toBe(
      'main'
    );
  });

  it('ausente fica vazio, para a tool pedir o valor em vez de adivinhar', () => {
    expect(loadConfig({ GITHUB_TOKEN: 'x' }).defaultBranch).toBeUndefined();
  });
});
