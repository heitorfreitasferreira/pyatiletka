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

  it('nao exige token na carga: vazio fica para o resolveAuth', () => {
    expect(loadConfig({ GITEA_URL: 'https://x' }).token).toBe('');
    expect(loadConfig({ PYATILETKA_PROVIDER: 'github' }).token).toBe('');
  });

  it('deriva base e host do remote quando falta GITEA_URL', () => {
    const c = loadConfig({}, 'gitea', undefined, 'git.corp');
    expect(c.baseUrl).toBe('https://git.corp');
    expect(c.host).toBe('git.corp');
  });

  it('host do GitHub tira o prefixo api. e aceita GH_TOKEN', () => {
    const c = loadConfig({ GITHUB_TOKEN: 't', GITHUB_API_URL: 'https://api.github.com' });
    expect(c.host).toBe('github.com');
    expect(loadConfig({ GH_TOKEN: 't' }).provider).toBe('github');
  });

  it('sem provider fica um estado valido, sem lancar', () => {
    const c = loadConfig({});
    expect(c.provider).toBeUndefined();
    expect(c.token).toBe('');
    expect(c.authSource).toBe('none');
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

describe('opcoes do plugin (v2)', () => {
  it('options sobrepoem o ambiente', () => {
    const c = loadConfig(
      { ...github, PYATILETKA_ORG: 'env-org', PYATILETKA_PROSE: 'block' },
      undefined,
      { org: 'opt-org', prose: 'warn' }
    );
    expect(c.org).toBe('opt-org');
    expect(c.prose).toBe('warn');
  });

  it('promoteOrder em lista vira a ordem de promocao', () => {
    const c = loadConfig({ ...github }, undefined, { promoteOrder: ['dev', 'hom', 'prod'] });
    expect(c.promoteOrder).toEqual(['dev', 'hom', 'prod']);
  });

  it('provider por options vence o ambiente', () => {
    const c = loadConfig(
      { GITEA_URL: 'https://x', GITEA_TOKEN: 't', GITHUB_TOKEN: 'g' },
      undefined,
      { provider: 'github' }
    );
    expect(c.provider).toBe('github');
  });

  it('options vazias nao mudam nada', () => {
    const c = loadConfig({ ...github, PYATILETKA_ORG: 'env-org' }, undefined, {});
    expect(c.org).toBe('env-org');
  });

  it('options nao carregam token nem URL, entao nao desviam credencial', () => {
    const c = loadConfig({ GITHUB_TOKEN: 'do-ambiente' }, undefined, {
      token: 'do-opencode',
      url: 'https://evil.example',
      baseUrl: 'https://evil.example',
    });
    expect(c.baseUrl).toBe('https://api.github.com');
    expect(c.token).toBe('do-ambiente');
  });
});
