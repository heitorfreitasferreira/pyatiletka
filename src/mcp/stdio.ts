import { createInterface } from 'node:readline';
import { JSONRPC, RPC, handle, type Handler, type RpcResponse } from './protocol';

/**
 * Transporte stdio do MCP: uma mensagem JSON-RPC por linha, no stdin, e a
 * resposta em uma linha no stdout. Nada alem disso pode ir para o stdout, senao
 * o cliente nao entende a linha.
 *
 * As chamadas nao sao serializadas: o Claude Code manda varias tools em
 * paralelo e uma espera de CI de 15 min nao pode segurar as outras. O processo
 * so termina quando o stdin fecha e nao ha chamada pendente.
 */

export type StdioStreams = {
  input: NodeJS.ReadableStream;
  output: { write(chunk: string): unknown };
  /** Onde vai o erro interno, que o cliente nao le. Ausente = descartado. */
  err?: { write(chunk: string): unknown };
};

const write = (stream: { write(chunk: string): unknown } | undefined, text: string) => {
  stream?.write(text);
};

export function parseError(): RpcResponse {
  return { jsonrpc: JSONRPC, id: null, error: { code: RPC.parse, message: 'JSON invalido' } };
}

/** Le e responde ate o stdin fechar. Devolve quando nao ha mais nada pendente. */
export async function serveStdio(streams: StdioStreams, handler: Handler): Promise<void> {
  const rl = createInterface({ input: streams.input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();

  const answer = (message: unknown) => {
    const task = (async () => {
      const response = await handle(message, handler);
      if (response) write(streams.output, `${JSON.stringify(response)}\n`);
    })().catch((e: unknown) => {
      // Uma falha aqui nao pode derrubar o servidor: o cliente ainda tem
      // outras chamadas a fazer.
      write(streams.err, `[pyatiletka] erro interno: ${e instanceof Error ? e.message : e}\n`);
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      write(streams.output, `${JSON.stringify(parseError())}\n`);
      continue;
    }
    answer(message);
  }

  await Promise.all(pending);
}
