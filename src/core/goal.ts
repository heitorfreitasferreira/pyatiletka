/**
 * Objetivo do /goal de uma issue e o sufixo de vinculo no titulo da sessao.
 *
 * O objetivo e montado no `issue_bind` a partir da issue e vai para o comando
 * `/goal` do opencode v2. O limite de 4000 caracteres e do comando nativo.
 */

export const GOAL_MAX = 4000;

export const GOAL_DONE =
  'O objetivo esta cumprido quando os criterios da issue estiverem atendidos e a issue estiver fechada com a tool `issue_close`.';

const TRUNCATED = '\n\n[corpo truncado]';
/** Sufixo do proprio plugin, para reescrever em vez de empilhar no rebind. */
const BIND_SUFFIX = /\s*\[[^\]\s]+#\d+\]$/;

/** Objetivo do /goal: issue, corpo e a regra de conclusao, dentro do limite do comando. */
export function goalObjective(input: {
  repo: string;
  number: number;
  title: string;
  body?: string | null;
}): string {
  const head = `Resolver ${input.repo}#${input.number}: ${input.title}`.trim();
  const body = (input.body ?? '').trim();
  const tail = GOAL_DONE;
  const room = GOAL_MAX - head.length - tail.length - 4;

  if (room <= 0) {
    const suffix = `\n\n${tail}`;
    return `${head.slice(0, Math.max(0, GOAL_MAX - suffix.length))}${suffix}`.slice(0, GOAL_MAX);
  }

  let clipped = body;
  if (body.length > room) {
    clipped =
      room > TRUNCATED.length
        ? `${body.slice(0, room - TRUNCATED.length).trimEnd()}${TRUNCATED}`
        : body.slice(0, room).trimEnd();
  }

  return [head, clipped, tail].filter(Boolean).join('\n\n');
}

/** Sufixo curto no titulo da sessao. Usa so o nome do repo. */
export function bindSuffix(repo: string, number: number): string {
  const short = repo.split('/').filter(Boolean).pop() ?? repo;
  return `[${short}#${number}]`;
}

/** Tira o sufixo de um bind anterior, preservando o nome original. */
export function withoutBindTitle(title: string): string {
  return title.replace(BIND_SUFFIX, '').trimEnd();
}

/** Acrescenta o sufixo do bind ao titulo, sem duplicar em rebind. */
export function withBindTitle(title: string, repo: string, number: number): string {
  const base = withoutBindTitle(title);
  const suffix = bindSuffix(repo, number);
  return base ? `${base} ${suffix}` : suffix;
}
