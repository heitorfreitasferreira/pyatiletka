import type { Config, ProviderName } from '../config';

/**
 * Cliente HTTP compartilhado. Cada provider ajusta base, headers e nomes de
 * paginacao. Erros carregam status para quem chama decidir (404, 401, 500).
 */

export class GitHostError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string
  ) {
    super(`GitHost ${status} ${path}: ${describeBody(body)}`);
    this.name = 'GitHostError';
  }
}

/**
 * Resume o corpo do erro.
 *
 * Quando o servidor esta fora do ar quem responde e o proxy, com uma pagina
 * HTML inteira. Jogar isso no output da tool enche o contexto do agente de
 * ruido e nao diz nada. Pega so o titulo, ou marca como HTML.
 */
export function describeBody(raw: string, max = 400): string {
  const text = raw.trim();
  if (!text) return '(corpo vazio)';
  if (!/^<(?:!doctype|html)/i.test(text)) return text.slice(0, max);

  const title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  const hint = title ? `: ${title}` : '';
  return `(resposta HTML do servidor ou proxy${hint})`;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PageParam = 'limit' | 'per_page';

export type HttpOptions = {
  /** Nome do parametro de tamanho de pagina. Gitea: limit. GitHub: per_page. */
  pageParam: PageParam;
  method?: string;
  body?: unknown;
  /** Cabecalhos extras. */
  headers?: Record<string, string>;
  retries?: number;
};

/** Opcoes de uma chamada avulsa. `pageParam` so faz sentido em `requestAll`. */
type SendOptions = Omit<HttpOptions, 'pageParam'>;

export class Http {
  constructor(
    readonly provider: ProviderName,
    readonly baseUrl: string,
    readonly token: string
  ) {}

  static fromConfig(c: Config): Http {
    return new Http(c.provider, c.baseUrl, c.token);
  }

  redact(s: string): string {
    let out = s;
    if (this.token) out = out.split(this.token).join('***REDACTED***');
    return out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi, '$1***@');
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: this.provider === 'gitea' ? `token ${this.token}` : `Bearer ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(extra ?? {}),
    };
    if (this.provider === 'github') h['X-GitHub-Api-Version'] = '2022-11-28';
    return h;
  }

  /** Fetch com retry em 5xx/429. Devolve o corpo em texto, sem parsear. */
  async requestText(path: string, opts: SendOptions = {}): Promise<string> {
    const { retries = 3, method = 'GET', body, headers } = opts;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: this.headers(headers),
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        lastErr = e;
        if (attempt === retries) break;
        await sleep(500 * 2 ** attempt);
        continue;
      }

      if (res.ok) return res.text();

      const errBody = this.redact(await res.text());
      const err = new GitHostError(res.status, path, errBody);
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        lastErr = err;
        await sleep(700 * 2 ** attempt);
        continue;
      }
      throw err;
    }
    throw lastErr instanceof Error ? lastErr : new Error(`falha ao chamar ${path}`);
  }

  /** GET/POST/PATCH/DELETE em um path relativo a base. Retry em 5xx/429. */
  async request<T = unknown>(path: string, opts: HttpOptions): Promise<T> {
    const { pageParam: _pageParam, ...rest } = opts;
    const res = await this.requestText(path, rest);
    return (res ? JSON.parse(res) : undefined) as T;
  }

  /** GET paginado ate `cap` itens. Para quando o lote vem menor que a pagina. */
  async requestAll<T>(
    path: string,
    opts: HttpOptions & { cap?: number; perPage?: number }
  ): Promise<T[]> {
    const cap = opts.cap ?? 500;
    const perPage = opts.perPage ?? 50;
    const sep = path.includes('?') ? '&' : '?';
    const out: T[] = [];
    for (let page = 1; page * perPage <= cap; page++) {
      const batch = await this.request<T[]>(
        `${path}${sep}${opts.pageParam}=${perPage}&page=${page}`,
        opts
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch);
      if (batch.length < perPage) break;
    }
    return out;
  }
}
