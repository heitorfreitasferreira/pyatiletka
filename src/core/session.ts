import { fmtComment, fmtIssue } from './format';
import type { Binding } from './binding';
import type { Ctx } from './context';

/**
 * Texto injetado na sessao a partir do vinculo. Vive aqui para o v1
 * (`experimental.chat.system.transform`) e o v2 (`ctx.session.hook("context")`)
 * usarem a mesma mensagem.
 */

/** Regras que o agente segue enquanto o vinculo estiver ativo. */
export function bindingPrompt(repo: string, issue?: number, milestone?: string): string {
  return [
    '',
    '## Contexto da sessao: issue vinculada',
    '',
    `Esta sessao esta vinculada a **${repo}#${issue}**${
      milestone ? ` (marco/epico: ${milestone})` : ''
    }.`,
    '',
    'Regras enquanto o vinculo estiver ativo:',
    '- Trabalhe **dentro** do escopo e do criterio de aceite desta issue.',
    '- Os comentarios abaixo sao o log de trabalho e contexto obrigatorio: leia-os antes de agir.',
    '- Registre progresso com `issue_comment` (blocos `## Update YYYY-MM-DD`) em vez de narrar de novo.',
    '- Marque `Status/In Progress` ao comecar. Se travar, use `Status/Blocked`, comente e **pergunte** ao usuario.',
    '- Nao feche a issue sem verificar o criterio de aceite.',
    '- Pendencias descobertas viram `issue_create` no mesmo marco.',
  ].join('\n');
}

/**
 * Cabecalho do turno: regras, a issue e os comentarios. Falha ao ler a issue
 * nao derruba o turno: o vinculo continua valendo e o aviso vai junto.
 */
export async function buildSystemHead(ctx: Ctx, b: Binding): Promise<string> {
  let head = bindingPrompt(b.repo, b.issue, b.milestone);
  if (!b.issue) return head;

  try {
    const issue = await ctx.host.getIssue(b.repo, b.issue);
    head += `\n### ${fmtIssue(issue)}\n\n<details><summary>corpo da issue</summary>\n\n${issue.body ?? ''}\n\n</details>\n`;
    head += `\nlabels: ${issue.labels.length ? issue.labels.join(', ') : '(nenhuma)'}\n`;

    const comments = await ctx.host.listComments(b.repo, b.issue).catch(() => []);
    if (comments.length) {
      head += `\n### Comentarios (${comments.length}): log de trabalho\n`;
      if (comments.length < (issue.comments ?? 0)) {
        head += `> a API devolveu ${comments.length} de ${issue.comments} comentarios\n`;
      }
      for (const c of comments) head += `\n${fmtComment(c)}\n`;
    }
  } catch (e) {
    head += `\n> Falha ao ler a issue: ${e instanceof Error ? e.message : String(e)}\n`;
  }

  return head;
}

/** Nota que preserva o vinculo atraves de compaction. */
export function compactionNote(b: Binding): string {
  return (
    `Sessao vinculada a issue ${b.repo}#${b.issue}${
      b.milestone ? ` (marco ${b.milestone})` : ''
    }. Ao retomar, chame issue_view nessa issue: ela traz o corpo e TODOS os comentarios, ` +
    'que sao o log de trabalho. Continue de onde parou e registre progresso com issue_comment.'
  );
}
