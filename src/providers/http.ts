import type { Config, ProviderName } from '../config';

/**
 * Cliente HTTP compartilhado. Cada provider ajusta base, headers e nomes de
 * paginacao. Erros carregam status para quem chama decidir (404, 401, 500).
 */

export class ForgeError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string
  ) {
    super(`Forge ${status} ${path}: ${body.slice(0, 400)}`);
    this.name = 'ForgeError';
  }
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

  /** GET/POST/PATCH/DELETE em um path relativo a base. Retry em 5xx/429. */
  async request<T = unknown>(path: string, opts: HttpOptions): Promise<T> {
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

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const errBody = this.redact(await res.text());
      const err = new ForgeError(res.status, path, errBody);
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        lastErr = err;
        await sleep(700 * 2 ** attempt);
        continue;
      }
      throw err;
    }
    throw lastErr instanceof Error ? lastErr : new Error(`falha ao chamar ${path}`);
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
