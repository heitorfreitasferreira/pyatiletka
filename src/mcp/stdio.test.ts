import { describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { ToolSpec } from '../tools/spec';
import { RPC, type Handler, type RpcResponse } from './protocol';
import { serveStdio } from './stdio';

/**
 * O transporte tem uma regra so: uma linha de entrada vira no maximo uma linha
 * de saida, e nada mais pode aparecer no stdout.
 */

const source = (lines: string[]): Readable => Readable.from(lines.map((l) => `${l}\n`));

function collector() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    chunks: (): RpcResponse[] => lines.map((l) => JSON.parse(l) as RpcResponse),
    output: { write: (chunk: string) => void lines.push(...chunk.split('\n').filter(Boolean)) },
    err: { write: (chunk: string) => void errors.push(chunk) },
  };
}

const spec = (name: string, ms = 0): ToolSpec => ({
  group: 'ci',
  name,
  description: `tool ${name}`,
  args: {},
  execute: async () => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    return name;
  },
});

function handler(specs: ToolSpec[], version = '1.0.0'): Handler {
  return {
    specs,
    version,
    run: (s, args) => s.execute(args, { sessionID: 'ses' }),
  };
}

const call = (id: number, name: string) =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name } });

describe('serveStdio', () => {
  it('responde request e ignora notificacao', async () => {
    const io = collector();
    const input = source([JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })]);
    await serveStdio({ input, output: io.output, err: io.err }, handler([spec('runs')]));
    expect(io.lines).toEqual([]);
  });

  it('linha que nao e JSON vira erro de parse sem derrubar o resto', async () => {
    const io = collector();
    await serveStdio(
      { input: source(['{ isso nao e json', call(1, 'ci_runs')]), output: io.output, err: io.err },
      handler([spec('runs')])
    );
    const [first, second] = io.chunks();
    expect(first.error?.code).toBe(RPC.parse);
    expect(second.id).toBe(1);
    expect((second.result as { content: { text: string }[] }).content[0].text).toBe('runs');
  });

  it('linha vazia nao gera resposta', async () => {
    const io = collector();
    await serveStdio({ input: source(['', '   ']), output: io.output, err: io.err }, handler([]));
    expect(io.lines).toEqual([]);
  });

  it('chamada lenta nao segura a que veio depois', async () => {
    const io = collector();
    await serveStdio(
      {
        input: source([call(1, 'ci_lenta'), call(2, 'ci_rapida')]),
        output: io.output,
        err: io.err,
      },
      handler([spec('lenta', 30), spec('rapida')])
    );
    const order = io.chunks().map((r) => r.id);
    expect(order).toEqual([2, 1]);
  });

  it('falha da tool vira isError e nao escreve no stderr', async () => {
    const io = collector();
    const broken: Handler = {
      specs: [spec('runs')],
      version: '1.0.0',
      run: () => Promise.reject(new Error('sem credencial')),
    };
    await serveStdio(
      { input: source([call(1, 'ci_runs')]), output: io.output, err: io.err },
      broken
    );
    const res = io.chunks()[0];
    expect(res.error).toBeUndefined();
    expect((res.result as { isError?: boolean }).isError).toBe(true);
    expect(io.errors).toEqual([]);
  });

  it('argumento fora do schema vira resultado com isError', async () => {
    const io = collector();
    const spec2: ToolSpec = {
      group: 'ci',
      name: 'eco',
      description: 'eco',
      args: { n: z.number() },
      execute: async () => 'ok',
    };
    await serveStdio(
      {
        input: source([
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'ci_eco', arguments: { n: 'x' } },
          }),
        ]),
        output: io.output,
        err: io.err,
      },
      handler([spec2])
    );
    expect((io.chunks()[0].result as { isError?: boolean }).isError).toBe(true);
  });
});
