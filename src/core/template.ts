import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Template de issue lido do proprio repo.
 *
 * A UI so injeta o template quando a issue nasce por ela. Como aqui
 * toda issue nasce por `issue_create`, o plugin le o mesmo arquivo e usa como
 * corpo padrao, para template e API nao divergirem.
 *
 * Os dois caminhos convem porque os dois providers sao suportados:
 * `.github/ISSUE_TEMPLATE` (GitHub) e `.gitea/issue_template` (Gitea).
 */

export const TEMPLATE_DIRS = ['.gitea/issue_template', '.github/ISSUE_TEMPLATE'] as const;

export type Template = {
  /** Caminho absoluto do arquivo lido. */
  file: string;
  /** Corpo markdown, sem o frontmatter. */
  body: string;
  about?: string;
  titlePrefix: string;
  labels: string[];
};

/** Divide o frontmatter YAML do corpo markdown. */
export function splitFrontmatter(raw: string): { front: string; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { front: '', body: raw };
  return { front: m[1], body: raw.slice(m[0].length) };
}

/** `labels: ["a", "b"]` ou `- a` linha a linha. So o que a UI usa. */
export function frontLabels(front: string): string[] {
  const inline = front.match(/^labels:\s*\[(.*)\]/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return front
    .split('\n')
    .filter((l) => /^\s*-\s+\S/.test(l))
    .map((l) =>
      l
        .replace(/^\s*-\s+/, '')
        .trim()
        .replace(/^["']|["']$/g, '')
    );
}

export function frontField(front: string, key: string): string | undefined {
  const m = front.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

/**
 * Onde procurar: o `directory` do workspace pode ser a raiz de um monorepo, o
 * proprio repo, ou a pasta de um clone. Testa o repo primeiro e o workspace
 * depois, para o template do repo ganhar quando os dois tem um.
 */
function roots(directory: string, repo: string): string[] {
  const short = repo.split('/')[1] ?? repo;
  return [...new Set([join(directory, short), directory])];
}

function readTemplate(file: string): Template {
  const { front, body } = splitFrontmatter(readFileSync(file, 'utf8'));
  return {
    file,
    body: body.trim(),
    about: frontField(front, 'about'),
    titlePrefix: frontField(front, 'title') ?? '',
    labels: frontLabels(front),
  };
}

/**
 * Le um template do repo. Aceita `task`, `task.md` ou um path relativo dentro
 * de um dos diretorios de template. Um path com barra e usado como esta, para
 * o caller citar o arquivo exato.
 */
export function loadTemplate(directory: string, repo: string, name: string): Template {
  const raw = name.trim().replace(/^\/+/, '');
  const withExt = raw.endsWith('.md') ? raw : `${raw}.md`;
  const rel = raw.includes('/') ? withExt : null;

  const tried: string[] = [];
  for (const root of roots(directory, repo)) {
    const candidates = rel ? [join(root, rel)] : TEMPLATE_DIRS.map((d) => join(root, d, withExt));
    for (const f of candidates) {
      tried.push(f);
      if (existsSync(f)) return readTemplate(f);
    }
  }

  throw new Error(
    `template "${name}" nao encontrado em ${repo}. Procurado:\n${tried
      .map((t) => `  ${t}`)
      .join('\n')}`
  );
}

export type TemplateFile = Template & { name: string };

/** Lista os templates do repo. Vazio quando nao ha diretorio de template. */
export function listTemplates(directory: string, repo: string): TemplateFile[] {
  const out: TemplateFile[] = [];
  for (const root of roots(directory, repo)) {
    for (const d of TEMPLATE_DIRS) {
      const dir = join(root, d);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort()) {
        out.push({ name: f.replace(/\.md$/, ''), ...readTemplate(join(dir, f)) });
      }
    }
  }
  return out;
}

export type IssueFields = {
  objetivo?: string;
  criterios?: string[];
  contexto?: string;
};

/**
 * Monta o corpo da issue a partir dos campos. `objetivo` e obrigatorio: e a
 * secao que o `milestone_view` e o agente leem para saber o que a issue
 * entrega.
 */
export function buildBody(fields: IssueFields): string {
  if (!fields.objetivo) throw new Error('`objetivo` e obrigatorio com template.');
  const partes = [`## Objetivo\n\n${fields.objetivo}`];
  if (fields.criterios?.length) {
    partes.push(`## Criterio de aceite\n\n${fields.criterios.map((c) => `- [ ] ${c}`).join('\n')}`);
  }
  if (fields.contexto) partes.push(`## Contexto\n\n${fields.contexto}`);
  return partes.join('\n\n');
}
