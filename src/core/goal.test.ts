import { describe, expect, it } from 'bun:test';
import {
  GOAL_DONE,
  GOAL_MAX,
  bindSuffix,
  goalObjective,
  withBindTitle,
  withoutBindTitle,
} from './goal';

const REPO = 'org/repo';

describe('goalObjective', () => {
  it('monta issue, corpo e regra de conclusao', () => {
    const out = goalObjective({
      repo: REPO,
      number: 7,
      title: 'Corrigir fila',
      body: '## Objetivo\n\na fila para de travar',
    });

    expect(out.startsWith('Resolver org/repo#7: Corrigir fila')).toBe(true);
    expect(out).toContain('a fila para de travar');
    expect(out.endsWith(GOAL_DONE)).toBe(true);
  });

  it('sem corpo ainda tem objetivo e regra', () => {
    const out = goalObjective({ repo: REPO, number: 7, title: 'Corrigir fila' });
    expect(out).toBe(`Resolver org/repo#7: Corrigir fila\n\n${GOAL_DONE}`);
  });

  it('nunca passa do limite do /goal', () => {
    const out = goalObjective({
      repo: REPO,
      number: 7,
      title: 'Corrigir fila',
      body: 'x'.repeat(10_000),
    });

    expect(out.length).toBeLessThanOrEqual(GOAL_MAX);
    expect(out).toContain('[corpo truncado]');
    expect(out.endsWith(GOAL_DONE)).toBe(true);
  });

  it('titulo gigante tambem respeita o limite', () => {
    const out = goalObjective({ repo: REPO, number: 7, title: 'x'.repeat(10_000) });
    expect(out.length).toBeLessThanOrEqual(GOAL_MAX);
    expect(out.endsWith(GOAL_DONE)).toBe(true);
  });
});

describe('titulo da sessao', () => {
  it('usa so o nome do repo no sufixo', () => {
    expect(bindSuffix('org/repo', 7)).toBe('[repo#7]');
    expect(bindSuffix('repo', 7)).toBe('[repo#7]');
  });

  it('acrescenta sem alterar o nome', () => {
    expect(withBindTitle('Minha sessao', REPO, 7)).toBe('Minha sessao [repo#7]');
  });

  it('rebind troca o sufixo em vez de empilhar', () => {
    expect(withBindTitle('Minha sessao [repo#7]', REPO, 8)).toBe('Minha sessao [repo#8]');
  });

  it('sem nome, o sufixo fica sozinho', () => {
    expect(withBindTitle('', REPO, 7)).toBe('[repo#7]');
  });

  it('remove o sufixo e preserva o resto', () => {
    expect(withoutBindTitle('Minha sessao [repo#7]')).toBe('Minha sessao');
    expect(withoutBindTitle('Minha sessao')).toBe('Minha sessao');
  });
});
