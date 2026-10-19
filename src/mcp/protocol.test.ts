import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createToolSpecs } from '../tools/factory';
import { toolName, type ToolSpec } from '../tools/spec';
import { FakeGitHost } from '../testing/fake-git-host';
import { makeConfig } from '../testing/fixtures';
import type { Ctx } from '../core/context';
import {
  PROTOCOL_VERSION,
  RPC,
  SERVER_NAME,
  handle,
  listTools,
  toInputSchema,
  type Handler,
  type RpcResponse,
} from './protocol';

const echoSpec = (over: Partial<ToolSpec> = {}): ToolSpec => ({
  group: 'issue',
  name: 'echo',
  description: 'Devolve o texto recebido',
  args: { texto: z.string().describe('Texto a devolver') },
  execute: async (args) => `eco: ${(args as { texto: string }).texto}`,
  ...over,
});

function handlerWith(specs: ToolSpec[] = [echoSpec()]): Handler {
  return {
    specs,
    version: '9.9.9',
    instructions: 'instrucoes de teste',
    run: (spec, args) => spec.execute(args, { sessionID: 'ses_1' }),
  };
}

/** Resposta de um request, garantida. Notificacao devolve `undefined`. */
async function ask(message: unknown, handler = handlerWith()): Promise<RpcResponse> {
  const res = await handle(message, handler);
  if (!res) throw new Error('esperava resposta, veio nada');
  return res;
}

const request = (id: number, method: string, params?: unknown) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe('initialize', () => {
  it('ecoa a versao do cliente quando ela e conhecida', async () => {
    const res = await ask(request(1, 'initialize', { protocolVersion: '2024-11-05' }));
    const result = res.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe(SERVER_NAME);
  });

  it('usa a versao do servidor quando o cliente pede uma desconhecida', async () => {
    const res = await ask(request(1, 'initialize', { protocolVersion: '1999-01-01' }));
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('declara a capacidade de tools e leva as instrucoes', async () => {
    const res = await ask(request(1, 'initialize', {}));
    const result = res.result as {
      capabilities: { tools: { listChanged: boolean } };
      instructions: string;
    };
    expect(result.capabilities.tools.listChanged).toBe(false);
    expect(result.instructions).toBe('instrucoes de teste');
  });
});

describe('tools/list', () => {
  it('usa o nome do grupo como prefixo e descreve o schema', async () => {
    const res = await ask(request(2, 'tools/list'));
    const tools = (res.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(1);
    const tool = tools[0] as {
      name: string;
      description: string;
      inputSchema: { type: string; properties: Record<string, unknown>; required: string[] };
    };
    expect(tool.name).toBe('issue_echo');
    expect(tool.description).toBe('Devolve o texto recebido');
    expect(tool.inputSchema.type).toBe('object');
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['texto']);
    expect(tool.inputSchema.required).toEqual(['texto']);
  });

  it('campo opcional nao entra em required', async () => {
    const spec = echoSpec({ args: { texto: z.string().optional() } });
    const desc = listTools([spec]).tools[0];
    expect(desc.inputSchema.required).toBeUndefined();
  });
});

describe('tools/call', () => {
  it('devolve o texto da tool como conteudo', async () => {
    const res = await ask(
      request(3, 'tools/call', { name: 'issue_echo', arguments: { texto: 'oi' } })
    );
    const result = res.result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.content).toEqual([{ type: 'text', text: 'eco: oi' }]);
    expect(result.isError).toBeUndefined();
  });

  it('argumento invalido vira erro legivel, nao excecao', async () => {
    const res = await ask(request(3, 'tools/call', { name: 'issue_echo', arguments: {} }));
    const result = res.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Argumentos invalidos');
    expect(result.content[0].text).toContain('texto');
  });

  it('tool que lanca devolve mensagem com isError', async () => {
    const spec = echoSpec({
      execute: async () => {
        throw new Error('sem credencial');
      },
    });
    const res = await ask(
      request(4, 'tools/call', { name: 'issue_echo', arguments: { texto: 'x' } }),
      handlerWith([spec])
    );
    const result = res.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('sem credencial');
  });

  it('tool desconhecida e erro de parametro', async () => {
    const res = await ask(request(5, 'tools/call', { name: 'nao_existe' }));
    expect(res.error?.code).toBe(RPC.invalidParams);
    expect(res.error?.message).toContain('nao_existe');
  });
});

describe('mensagens que nao sao request', () => {
  it('notificacao nao gera resposta', async () => {
    const res = await handle(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      handlerWith()
    );
    expect(res).toBeUndefined();
  });

  it('metodo desconhecido vira -32601', async () => {
    const res = await ask(request(6, 'foo/bar'));
    expect(res.error?.code).toBe(RPC.methodNotFound);
    expect(res.error?.message).toContain('foo/bar');
  });

  it('mensagem que nao e objeto vira -32600', async () => {
    const res = await ask('nao e objeto');
    expect(res.error?.code).toBe(RPC.invalidRequest);
  });

  it('request sem method vira -32600', async () => {
    const res = await ask({ jsonrpc: '2.0', id: 7 });
    expect(res.error?.code).toBe(RPC.invalidRequest);
  });

  it('ping responde vazio', async () => {
    const res = await ask(request(8, 'ping'));
    expect(res.result).toEqual({});
  });

  it('listagens que o servidor nao declara respondem vazio', async () => {
    for (const method of ['resources/list', 'resources/templates/list', 'prompts/list']) {
      const res = await ask(request(9, method));
      expect(res.error).toBeUndefined();
    }
  });
});

describe('schema das tools reais', () => {
  const ctx: Ctx = {
    host: new FakeGitHost(),
    config: makeConfig(),
    defaultRepo: 'org/repo',
    notify: () => {},
  };

  const specs = createToolSpecs({ ctx, directory: '/w' });

  it('as 38 tools viram JSON Schema de objeto', () => {
    expect(specs).toHaveLength(38);
    for (const spec of specs) {
      const schema = toInputSchema(spec.args);
      expect(schema.type, toolName(spec)).toBe('object');
      expect(typeof schema.properties, toolName(spec)).toBe('object');
    }
  });

  it('descricao e propriedades chegam ao cliente', () => {
    const list = listTools(specs).tools;
    const issueList = list.find((t) => t.name === 'issue_list');
    expect(issueList?.description).toContain('Lista');
    expect(Object.keys(issueList?.inputSchema.properties ?? {})).toContain('milestone');
    expect(list.map((t) => t.name)).toContain('ci_wait');
  });
});
