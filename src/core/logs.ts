import type { LogsOptions } from '../providers/types';

/**
 * Tratamento de log de run compartilhado entre providers. Cada provider
 * entrega o texto cru, e daqui sai o resumo barato (linhas de erro) ou o
 * recorte pedido por step/grep/tail.
 */

/** Linhas que parecem erro de build, para o resumo barato do log. */
export function errorLines(log: string): string[] {
  const pats = [
    /\berror\b/i,
    /\bfailed\b/i,
    /\bfailure\b/i,
    /\bcannot\b/i,
    /\bdenied\b/i,
    /\bnot found\b/i,
    /\bexception\b/i,
    /✗|❌/,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of log.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
    if (!line || line.length < 8) continue;
    if (!pats.some((p) => p.test(line))) continue;
    const key = line.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key.length > 200 ? `${key.slice(0, 200)}...` : key);
    if (out.length >= 40) break;
  }
  return out;
}

export function shapeLog(raw: string, opts: LogsOptions): string {
  let log = raw;
  if (opts.grep) {
    const re = new RegExp(opts.grep, 'i');
    log = log
      .split('\n')
      .filter((l) => re.test(l))
      .join('\n');
  }
  if (!opts.full) {
    const errs = errorLines(log);
    log = errs.length
      ? `(${errs.length} linhas de erro; \`full:true\` traz tudo)\n${errs.join('\n')}`
      : '(nenhuma linha de erro encontrada; `full:true` traz o log inteiro)';
  }
  const tail = opts.tail ?? 200;
  const lines = log.split('\n');
  const sliced = lines.length > tail ? lines.slice(-tail) : lines;
  const header =
    lines.length > tail ? `(${lines.length} linhas no total, mostrando as ultimas ${tail})\n` : '';
  return `${header}${sliced.join('\n')}`;
}
