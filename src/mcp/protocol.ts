import { z } from 'zod';
import { toolName, type ToolSpec } from '../tools/spec';

/**
 * Protocolo MCP sobre stdio, sem I/O. O transporte vive em `stdio.ts` e o
 * Claude Code e o cliente. Cada mensagem e um JSON-RPC 2.0 em uma linha.
 *
 * So o que o plugin precisa: `initialize`, `tools/list` e `tools/call`. O resto
 * das opcoes do protocolo fica de fora de proposito, e o cliente recebe
 * `-32601` quando pede algo que nao existe.
 */

/** Versoes que o servidor aceita. A resposta ecoa a do cliente quando esta na lista. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];
export const SERVER_NAME = 'pyatiletka';

export const JSONRPC = '2.0';

export type RpcId = string | number | null;

export type RpcRequest = {
  jsonrpc: string;
  id?: RpcId;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  jsonrpc: typeof JSONRPC;
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type ToolContent = { type: 'text'; text: string };

export type ToolCallResult = {
  content: ToolContent[];
  isError?: boolean;
};

export type ToolDescription = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** Execucao de uma tool: quem chama informa a sessao e o sinal. */
export type ToolRunner = (spec: ToolSpec, args: unknown) => Promise<string>;

/** Codigos de erro JSON-RPC usados aqui. */
export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/**
 * Schema de entrada de uma tool em JSON Schema. O `args` de cada spec ja e zod,
 * entao a conversao e a do proprio zod. Fica em cache porque e o mesmo objeto
 * para toda chamada de `tools/list`.
 */
export function toInputSchema(args: ToolSpec['args']): Record<string, unknown> {
  return z.toJSONSchema(z.object(args), {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}

const schemaCache = new Map<string, z.ZodObject<z.ZodRawShape>>();

function schemaOf(spec: ToolSpec): z.ZodObject<z.ZodRawShape> {
  const name = toolName(spec);
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const schema = z.object(spec.args);
  schemaCache.set(name, schema);
  return schema;
}

export function describeTool(spec: ToolSpec): ToolDescription {
  return {
    name: toolName(spec),
    description: spec.description,
    inputSchema: toInputSchema(spec.args),
  };
}

export function listTools(specs: ToolSpec[]): { tools: ToolDescription[] } {
  return { tools: specs.map(describeTool) };
}

/**
 * Chama a tool. Argumento que nao bate com o schema vira erro legivel para o
 * agente, e nao excecao. Excecao da tool tambem vira `isError`, porque o
 * agente le o texto e decide o proximo passo.
 */
export async function callTool(
  specs: ToolSpec[],
  params: unknown,
  run: ToolRunner
): Promise<ToolCallResult> {
  const input = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = typeof input.name === 'string' ? input.name : '';
  const spec = specs.find((s) => toolName(s) === name);
  if (!spec) throw new RpcError(RPC.invalidParams, `tool desconhecida: ${name || '(vazia)'}`);

  const parsed = schemaOf(spec).safeParse(input.arguments ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n  ');
    return {
      content: [{ type: 'text', text: `Argumentos invalidos:\n  ${issues}` }],
      isError: true,
    };
  }

  try {
    const text = await run(spec, parsed.data);
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

export type ServerInfo = { name: string; version: string };

export type Handler = {
  specs: ToolSpec[];
  run: ToolRunner;
  version: string;
  /** Texto que o cliente mostra ao modelo junto com a lista de tools. */
  instructions?: string;
};

function initializeResult(params: unknown, handler: Handler, info: ServerInfo): unknown {
  const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  const version =
    typeof asked === 'string' && (PROTOCOL_VERSIONS as readonly string[]).includes(asked)
      ? asked
      : PROTOCOL_VERSION;
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: info,
    ...(handler.instructions ? { instructions: handler.instructions } : {}),
  };
}

/**
 * Trata uma mensagem. Devolve `undefined` para notificacao, que por definicao
 * nao tem resposta. Entrada invalida nunca lanca: vira erro JSON-RPC.
 */
export async function handle(
  message: unknown,
  handler: Handler,
  info: ServerInfo = { name: SERVER_NAME, version: handler.version }
): Promise<RpcResponse | undefined> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return {
      jsonrpc: JSONRPC,
      id: null,
      error: { code: RPC.invalidRequest, message: 'mensagem invalida' },
    };
  }

  const req = message as RpcRequest;
  const id = req.id ?? null;
  const notification = req.id === undefined;

  if (typeof req.method !== 'string') {
    return notification
      ? undefined
      : { jsonrpc: JSONRPC, id, error: { code: RPC.invalidRequest, message: 'method ausente' } };
  }

  try {
    const result = await dispatch(req, handler, info);
    if (notification) return undefined;
    return { jsonrpc: JSONRPC, id, result };
  } catch (e) {
    const err =
      e instanceof RpcError
        ? { code: e.code, message: e.message, ...(e.data === undefined ? {} : { data: e.data }) }
        : { code: RPC.internal, message: e instanceof Error ? e.message : String(e) };
    if (notification) return undefined;
    return { jsonrpc: JSONRPC, id, error: err };
  }
}

async function dispatch(req: RpcRequest, handler: Handler, info: ServerInfo): Promise<unknown> {
  switch (req.method) {
    case 'initialize':
      return initializeResult(req.params, handler, info);

    case 'ping':
      return {};

    case 'tools/list':
      return listTools(handler.specs);

    case 'tools/call':
      return callTool(handler.specs, req.params, handler.run);

    // O servidor nao declara estes recursos. Responder vazio e mais barato do
    // que devolver erro para um cliente que varre tudo.
    case 'resources/list':
      return { resources: [] };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'prompts/list':
      return { prompts: [] };

    case 'logging/setLevel':
      return {};

    // Notificacoes do cliente. Nao ha estado a mudar.
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return {};

    default:
      throw new RpcError(RPC.methodNotFound, `metodo nao suportado: ${req.method}`);
  }
}
