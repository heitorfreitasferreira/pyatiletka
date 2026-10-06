import phrases from './phrases.json';

/**
 * Checagem de prosa no padrao da skill unsloppify (MIT, ver
 * THIRD_PARTY_LICENSES/unsloppify-LICENSE). Duas camadas:
 *
 * - Regras de casa e frases sem uso literal possivel: **erro**. No modo
 *   `block` a tool de escrita recusa e o texto nao e gravado.
 * - Frases que sao pergunta de julgamento (podem ser o termo exato do caso):
 *   **aviso**. Inclui a lista canonica da skill, embutida em
 *   `phrases.json` para o usuario nao precisar instalar nada.
 *
 * Trechos em code span, bloco de codigo, URL e aspas sao ignorados: material
 * citado e identificador literal ficam como estao. Nome existente com
 * travessao continua citavel dentro de crase.
 */

export type SlopHit = {
  severity: 'error' | 'warn';
  rule: string;
  match: string;
  context: string;
};

export type ProseMode = 'off' | 'warn' | 'block';

type Pattern = { rule: string; rx: RegExp; sev: 'error' | 'warn' };

const HOUSE: Pattern[] = [
  {
    rule: 'travessao (—): use dois-pontos, virgula ou reescreva',
    rx: /—/g,
    sev: 'error',
  },
  {
    rule: 'ponto e virgula em prosa: separe em duas frases ou use virgula',
    rx: /;/g,
    sev: 'error',
  },
  {
    rule: 'ponto medio (·) como separador',
    rx: /·/g,
    sev: 'error',
  },
  {
    rule: 'bullet (•) como separador',
    rx: /•/g,
    sev: 'warn',
  },
];

// Nucleo de slop sem uso literal possivel, EN e pt-BR. Bloqueia. So entram
// frases que nao tem leitura tecnica.
const CORE: Pattern[] = [
  {
    rule: 'importancia inflada: corte a frase e diga o fato',
    rx: /\bit(?:'s| is) (?:worth|important) (?:noting|mentioning)\b|\bit(?:'s| is) worth (?:noting|mentioning|pointing out)\b/gi,
    sev: 'error',
  },
  {
    rule: 'importancia inflada: corte a frase e diga o fato',
    rx: /\b(?:it|this) (?:goes without saying|should be noted|bears mentioning)\b/gi,
    sev: 'error',
  },
  {
    rule: 'drama fabricado: diga o fato direto',
    rx: /\blet that sink in\b|\bthe truth is\b|\bhere(?:'s| is) the catch\b/gi,
    sev: 'error',
  },
  {
    rule: 'drama fabricado: negacao-e-revelacao (nao e X, e Y)',
    rx: /\b(?:it(?:'s| is)|that(?:'s| is)) not (?:just|only|merely)\b[^.\n]{0,80}\bit(?:'s| is)\b/gi,
    sev: 'error',
  },
  {
    rule: 'registro performatico: use o verbo direto',
    rx: /\b(?:delve|delving) into\b|\bplays? a (?:crucial|vital|pivotal|key) role\b|\bpaving the way\b|\b(?:stands?|stood) as a testament\b|\bserves? as a reminder\b/gi,
    sev: 'error',
  },
  {
    rule: 'template: corte a abertura ou o fecho de formula',
    rx: /\bin conclusion\b|\bat the end of the day\b|\bin today(?:'s| is) (?:fast-paced|digital|world)\b|\bwhen it comes to\b/gi,
    sev: 'error',
  },
  {
    rule: 'vazamento de processo: o texto deve existir sem a sessao',
    rx: /\bi hope (?:this|that) helps?\b|\bfeel free to (?:ask|reach out)\b|\bdon(?:'t| not) hesitate to\b|\b(?:as|per) (?:mentioned|noted|discussed) (?:above|earlier)\b|\bper review feedback\b/gi,
    sev: 'error',
  },
  {
    rule: 'importancia inflada: corte a frase e diga o fato',
    rx: /\bvale (?:notar|mencionar|ressaltar|destacar|lembrar|dizer)\b|\b(?:e|é|eh) importante (?:notar|mencionar|ressaltar|destacar|frisar)\b|\bcabe (?:notar|mencionar|ressaltar|destacar|frisar)\b/gi,
    sev: 'error',
  },
  {
    rule: 'importancia inflada: corte a frase e diga o fato',
    rx: /\bde (?:suma|extrema|fundamental|vital) import[âa]ncia\b|\b(?:desempenha|exerce|tem|assume) (?:um )?papel (?:crucial|fundamental|essencial|vital|chave|central)\b/gi,
    sev: 'error',
  },
  {
    rule: 'drama fabricado: diga o fato direto',
    rx: /\ba verdade [eé] que\b|\bn[ãa]o (?:[eé]|eh) (?:apenas|s[óo]|somente)\b[^.\n]{0,80}\b(?:mas|[eé])\b/gi,
    sev: 'error',
  },
  {
    rule: 'template: corte a abertura ou o fecho de formula',
    rx: /\b(?:em conclus[ãa]o|concluindo|em suma)\b|\b(?:em um mundo cada vez mais|no mundo de hoje|nos dias de hoje)\b/gi,
    sev: 'error',
  },
  {
    rule: 'vazamento de processo: o texto deve existir sem a sessao',
    rx: /\bespero (?:ter|que tenha) ajudado\b|\b(?:fico|estou|estamos) [àa] disposi[çc][ãa]o\b|\bn[ãa]o hesite em\b|\b(?:como|conforme) (?:mencionado|discutido|dito acima|visto acima)\b/gi,
    sev: 'error',
  },
  {
    rule: 'registro performatico: confira se e o termo exato do caso',
    rx: /\b(?:aprofundar|mergulhar|alavancar|robust[oa]s?|sinergia|hol[íi]stic[oa])\b|\bsem costura\b/gi,
    sev: 'warn',
  },
];

let skillCache: Pattern[] | null = null;

/** Lista canonica da skill, embutida. Tudo nela e aviso. */
function skillPatterns(): Pattern[] {
  if (skillCache) return skillCache;
  skillCache = [];
  for (const raw of phrases.text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '—' || line === '[·•]' || line === '→|⇒') continue;
    const rx = line.replace(/\[\[:space:\]\]/g, '\\s');
    try {
      skillCache.push({ rule: 'skill unsloppify', rx: new RegExp(rx, 'gi'), sev: 'warn' });
    } catch {
      /* padrao incompativel com JS: ignora */
    }
  }
  return skillCache;
}

/** Remove code span, bloco, URL e trecho entre aspas: material citado. */
function stripLiteral(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/“[^”\n]*”/g, ' ');
}

function contextOf(text: string, index: number) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineEnd = text.indexOf('\n', index);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  return line.trim().slice(0, 160);
}

export function lintProse(text: string): SlopHit[] {
  if (!text?.trim()) return [];
  const scan = stripLiteral(text);
  const out: SlopHit[] = [];
  for (const p of [...HOUSE, ...CORE, ...skillPatterns()]) {
    p.rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.rx.exec(scan)) !== null) {
      out.push({
        severity: p.sev,
        rule: p.rule,
        match: m[0],
        context: contextOf(text, m.index),
      });
      if (m.index === p.rx.lastIndex) p.rx.lastIndex++;
    }
  }
  // Um mesmo trecho pode casar em duas listas; o erro e o que vale.
  const errored = new Set(
    out.filter((h) => h.severity === 'error').map((h) => h.match.toLowerCase())
  );
  return out.filter((h) => h.severity === 'error' || !errored.has(h.match.toLowerCase()));
}

function formatWarns(warns: SlopHit[]): string[] {
  const uniq = new Map<string, SlopHit>();
  for (const h of warns) uniq.set(h.match.toLowerCase(), h);
  return [
    '',
    `unsloppify: ${warns.length} aviso(s), confira se e o termo exato do caso, senao revise:`,
    ...[...uniq.values()].map((h) => `  aviso "${h.match}" em: ${h.context}`),
  ];
}

/**
 * Roda o lint e devolve o aviso para anexar na saida. No modo `block` lanca
 * se houver erro: o texto nao e gravado. No modo `warn`, erros viram aviso.
 */
export function assertProse(
  text: string | undefined,
  where: string,
  mode: ProseMode = 'block'
): string {
  if (mode === 'off') return '';
  const hits = lintProse(text ?? '');
  const errors = hits.filter((h) => h.severity === 'error');
  const warns = hits.filter((h) => h.severity === 'warn');

  if (errors.length && mode === 'block') {
    const lines = [
      `unsloppify recusou ${where}: ${errors.length} violacao(oes) mecanica(s)/de formula. O texto NAO foi gravado.`,
      ...errors.map((h) => `  erro  ${h.rule}\n        "${h.match}" em: ${h.context}`),
      '',
      'Reescreva e chame de novo. Regras em README (secao Checagem de prosa).',
      'Termo tecnico legitimo (smoke test, cutover, harness) nao bloqueia: vira aviso.',
    ];
    if (warns.length) lines.push(...formatWarns(warns));
    throw new Error(lines.join('\n'));
  }

  const all = mode === 'block' ? warns : hits;
  return all.length ? formatWarns(all).join('\n') : '';
}
