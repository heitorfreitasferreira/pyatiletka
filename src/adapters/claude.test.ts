import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  CLAUDE_STATE_DIR,
  CLAUDE_TOOL_PREFIX,
  claudeProjectDir,
  claudeSessionID,
  claudeStateDir,
  claudeToolPrefix,
} from './claude';

/**
 * O que o adaptador le do ambiente. `CLAUDE_PROJECT_DIR` e
 * `CLAUDE_CODE_SESSION_ID` vem do host, e `PYATILETKA_*` e do usuario.
 */

describe('claudeProjectDir', () => {
  it('usa CLAUDE_PROJECT_DIR quando existe', () => {
    expect(claudeProjectDir({ CLAUDE_PROJECT_DIR: '/proj' }, '/outro')).toBe('/proj');
  });

  it('cai no diretorio atual sem a variavel', () => {
    expect(claudeProjectDir({}, '/outro')).toBe('/outro');
  });

  it('ignora valor em branco', () => {
    expect(claudeProjectDir({ CLAUDE_PROJECT_DIR: '   ' }, '/outro')).toBe('/outro');
  });
});

describe('claudeStateDir', () => {
  it('PYATILETKA_STATE_DIR vence tudo', () => {
    const env = {
      PYATILETKA_STATE_DIR: '/estado',
      CLAUDE_PLUGIN_DATA: '/dados',
    };
    expect(claudeStateDir(env)).toBe('/estado');
  });

  it('sem nada disso usa o padrao relativo ao projeto', () => {
    expect(claudeStateDir({})).toBe(CLAUDE_STATE_DIR);
  });

  it('nao guarda estado dentro do clone quando o plugin da um diretorio', () => {
    const env = { CLAUDE_PLUGIN_DATA: '/dados' };
    expect(claudeStateDir(env)).toBe(join('/dados', 'state'));
  });
});

describe('claudeToolPrefix', () => {
  it('sem configuracao vale o nome do servidor embutido no plugin', () => {
    expect(claudeToolPrefix({})).toBe(CLAUDE_TOOL_PREFIX);
    expect(CLAUDE_TOOL_PREFIX).toBe('mcp__plugin_pyatiletka_pyatiletka__');
  });

  it('PYATILETKA_TOOL_PREFIX cobre o servidor declarado pelo usuario', () => {
    expect(claudeToolPrefix({ PYATILETKA_TOOL_PREFIX: 'mcp__pyatiletka__' })).toBe(
      'mcp__pyatiletka__'
    );
  });
});

describe('claudeSessionID', () => {
  it('usa a sessao do host quando existe', () => {
    expect(claudeSessionID({ CLAUDE_CODE_SESSION_ID: 'ses_9' })).toBe('ses_9');
  });

  it('tem rotulo fixo sem a variavel, porque o vinculo e do workspace', () => {
    expect(claudeSessionID({})).toBe('claude');
  });
});
