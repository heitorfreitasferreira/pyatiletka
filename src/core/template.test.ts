import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBody,
  frontField,
  frontLabels,
  listTemplates,
  loadTemplate,
  splitFrontmatter,
} from './template';

let dir: string;

const write = (rel: string, content: string) => {
  const f = join(dir, rel);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, content);
  return f;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pyatiletka-tpl-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('splitFrontmatter', () => {
  it('separa frontmatter de corpo', () => {
    const { front, body } = splitFrontmatter('---\ntitle: [Bug] x\n---\ncorpo\n');
    expect(front).toBe('title: [Bug] x');
    expect(body).toBe('corpo\n');
  });

  it('sem frontmatter, o corpo e o texto inteiro', () => {
    const { front, body } = splitFrontmatter('corpo sem nada');
    expect(front).toBe('');
    expect(body).toBe('corpo sem nada');
  });

  it('aceita CRLF', () => {
    const { front, body } = splitFrontmatter('---\r\nabout: y\r\n---\r\ncorpo');
    expect(front).toBe('about: y');
    expect(body).toBe('corpo');
  });
});

describe('frontLabels', () => {
  it('le lista inline', () => {
    expect(frontLabels('labels: ["Kind/Bug", "Priority/High"]')).toEqual([
      'Kind/Bug',
      'Priority/High',
    ]);
  });

  it('le lista com item por linha', () => {
    expect(frontLabels('about: x\nlabels:\n  - Kind/Bug\n  - Priority/Low')).toEqual([
      'Kind/Bug',
      'Priority/Low',
    ]);
  });

  it('tira aspas e devolve vazio sem labels', () => {
    expect(frontLabels('about: x')).toEqual([]);
  });
});

describe('frontField', () => {
  it('le campo simples', () => {
    expect(frontField('about: o que e\ntitle: "[Bug] "', 'about')).toBe('o que e');
    expect(frontField('about: o que e\ntitle: "[Bug] "', 'title')).toBe('[Bug] ');
  });

  it('campo ausente vira undefined', () => {
    expect(frontField('about: x', 'name')).toBeUndefined();
  });
});

describe('loadTemplate', () => {
  it('acha pelo nome simples, sem extensao, nos dois diretorios', () => {
    write('.gitea/issue_template/task.md', '---\ntitle: "[Task] "\n---\ncorpo gitea');
    expect(loadTemplate(dir, 'org/repo', 'task').titlePrefix).toBe('[Task] ');
    rmSync(join(dir, '.gitea'), { recursive: true });
    write('.github/ISSUE_TEMPLATE/task.md', '---\ntitle: "[Task] "\n---\ncorpo github');
    expect(loadTemplate(dir, 'org/repo', 'task').titlePrefix).toBe('[Task] ');
  });

  it('aceita o nome com .md', () => {
    write('.gitea/issue_template/bug.md', '---\nabout: defeito\n---\ncorpo');
    expect(loadTemplate(dir, 'org/repo', 'bug.md').about).toBe('defeito');
  });

  it('procura no clone do repo antes da raiz do workspace', () => {
    write('.gitea/issue_template/task.md', 'do workspace');
    write('repo/.gitea/issue_template/task.md', 'do repo');
    expect(loadTemplate(dir, 'org/repo', 'task').body).toBe('do repo');
  });

  it('aceita um path relativo dentro do diretorio de template', () => {
    write('.gitea/issue_template/sub/task.md', 'aninhado');
    expect(loadTemplate(dir, 'org/repo', '.gitea/issue_template/sub/task').body).toBe('aninhado');
  });

  it('nome ausente lista os caminhos tentados', () => {
    expect(() => loadTemplate(dir, 'org/repo', 'inexistente')).toThrow(
      /\.gitea\/issue_template\/inexistente\.md/
    );
  });
});

describe('listTemplates', () => {
  it('lista os dois diretorios, com o campo about', () => {
    write('.gitea/issue_template/task.md', '---\nabout: tarefa\nlabels: [Kind/Task]\n---\ncorpo');
    write('.github/ISSUE_TEMPLATE/bug.md', '---\nabout: defeito\n---\ncorpo');
    const all = listTemplates(dir, 'org/repo');
    expect(all.map((t) => t.name).sort()).toEqual(['bug', 'task']);
    expect(all.find((t) => t.name === 'task')?.about).toBe('tarefa');
    expect(all.find((t) => t.name === 'task')?.labels).toEqual(['Kind/Task']);
  });

  it('diretorio ausente devolve lista vazia', () => {
    expect(listTemplates(dir, 'org/repo')).toEqual([]);
  });
});

describe('buildBody', () => {
  it('monta objetivo, criterio e contexto', () => {
    expect(
      buildBody({ objetivo: 'Fila volta', criterios: ['teste', 'log'], contexto: 'contexto' })
    ).toBe(
      '## Objetivo\n\nFila volta\n\n## Criterio de aceite\n\n- [ ] teste\n- [ ] log\n\n## Contexto\n\ncontexto'
    );
  });

  it('omite secao vazia', () => {
    expect(buildBody({ objetivo: 'so isso' })).toBe('## Objetivo\n\nso isso');
  });

  it('objetivo e obrigatorio', () => {
    expect(() => buildBody({ criterios: ['a'] })).toThrow(/objetivo/);
  });
});
