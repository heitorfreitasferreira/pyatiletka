import { describe, expect, it } from 'bun:test';
import { assertProse, lintProse } from './index';

function errors(text: string) {
  return lintProse(text)
    .filter((h) => h.severity === 'error')
    .map((h) => h.match);
}
function warns(text: string) {
  return lintProse(text)
    .filter((h) => h.severity === 'warn')
    .map((h) => h.match);
}

describe('regras de casa', () => {
  it('bloqueia travessao', () => {
    expect(errors('Implementado — smoke verde.')).toEqual(['—']);
  });

  it('bloqueia ponto e virgula em prosa', () => {
    expect(errors('O cache cresce; o disco enche.')).toEqual([';']);
  });

  it('bloqueia ponto medio', () => {
    expect(errors('112,6G · 200M')).toEqual(['·']);
  });

  it('ignora travessao dentro de crase (nome existente)', () => {
    expect(errors('O marco `Lab — Funcionarios` segue aberto.')).toEqual([]);
  });

  it('ignora travessao entre aspas (material citado)', () => {
    expect(errors('O titulo e "Jev — Decisoes Tipadas".')).toEqual([]);
  });

  it('ignora ponto e virgula em codigo', () => {
    expect(errors('`export A=1; export B=2`')).toEqual([]);
    expect(errors('```sh\nexport A=1; export B=2\n```')).toEqual([]);
  });

  it('ignora pontuacao dentro de URL', () => {
    expect(errors('Ver https://exemplo.com/a;b?x=1 para o log.')).toEqual([]);
  });
});

describe('nucleo de frases', () => {
  it('bloqueia frase de formula EN', () => {
    expect(errors("It's worth noting that the cache helps.")).toContain("It's worth noting");
  });

  it('bloqueia frase de formula pt-BR', () => {
    expect(errors('Vale notar que o disco enche.')).toContain('Vale notar');
  });

  it('bloqueia negacao-e-revelacao pt-BR', () => {
    expect(errors('Nao e apenas um cache, e uma arquitetura nova.').length).toBeGreaterThan(0);
  });

  it('nao duplica erro e aviso do mesmo trecho', () => {
    const hits = lintProse("It's worth noting that the cache helps.");
    const matches = hits.filter((h) => h.match.toLowerCase() === "it's worth noting");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe('error');
  });
});

describe('lista canonica da skill (aviso)', () => {
  it('avisa sobre termo de dominio sem bloquear', () => {
    expect(errors('O smoke test roda no CI. O cutover segue na #24.')).toEqual([]);
    expect(warns('O smoke test roda no CI. O cutover segue na #24.')).toContain('smoke test');
  });

  it('avisa sobre serves as', () => {
    expect(errors('The validator serves as a gatekeeper.')).toEqual([]);
    expect(warns('The validator serves as a gatekeeper.').length).toBeGreaterThan(0);
  });
});

describe('assertProse', () => {
  it('lanca no modo block', () => {
    expect(() => assertProse('Feito — validei tudo.', 'comentario')).toThrow(/recusou/);
  });

  it('nao lanca no modo warn e devolve os hits', () => {
    const out = assertProse('Feito — validei tudo.', 'comentario', 'warn');
    expect(out).toContain('aviso');
  });

  it('nao faz nada no modo off', () => {
    expect(assertProse('Feito — validei tudo.', 'comentario', 'off')).toBe('');
  });

  it('texto limpo passa sem aviso', () => {
    expect(assertProse('O worker grava o digest. O Argo aplica depois.', 'corpo')).toBe('');
  });
});
