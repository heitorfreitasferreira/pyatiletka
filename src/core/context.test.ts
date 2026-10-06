import { describe, expect, it } from 'bun:test';
import { matchGlob, normRepo, parseRef, parseRefs } from './context';

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
    expect(() => normRepo('repo')).toThrow(/FORGE_ORG/);
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
    expect(matchGlob('infra-k3s', 'infra-*')).toBe(true);
    expect(matchGlob('api', 'infra-*')).toBe(false);
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
