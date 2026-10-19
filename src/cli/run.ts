import { VERSION } from '../version';
import { createHandler } from '../mcp/server';
import { serveStdio } from '../mcp/stdio';
import { HOOKS, type HookInput, type HookName } from './hooks';

/**
 * Duas entradas, um binario. `pyatiletka mcp` sobe o servidor MCP e
 * `pyatiletka hook <nome>` atende um evento do Claude Code.
 *
 * O stdout e do protocolo: no MCP, cada linha e uma resposta JSON-RPC, e o
 * hook escreve um unico JSON. Recado para o usuario vai no stderr.
 */

export type CliIo = {
  input: NodeJS.ReadableStream;
  output: { write(chunk: string): unknown };
  err: { write(chunk: string): unknown };
};

export const HELP = `pyatiletka ${VERSION}

Uso:
  pyatiletka mcp            Servidor MCP (stdio) das tools de issue, PR e CI.
  pyatiletka hook context   Contexto do vinculo, para SessionStart e UserPromptSubmit.
  pyatiletka hook push      Espera o CI depois de um git push, para PostToolUse.
  pyatiletka --version

Ambiente: PYATILETKA_STATE_DIR, PYATILETKA_PROVIDER, PYATILETKA_ORG,
PYATILETKA_DEFAULT_REPO, GITEA_URL, GITEA_TOKEN, GITHUB_TOKEN.
`;

export const HOOK_NAMES = Object.keys(HOOKS) as HookName[];

export function isHookName(value: string | undefined): value is HookName {
  return value !== undefined && value in HOOKS;
}

async function readAll(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function parseHookInput(raw: string): HookInput | undefined {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as HookInput) : {};
  } catch {
    return undefined;
  }
}

async function runHook(
  name: string | undefined,
  io: CliIo,
  env: NodeJS.ProcessEnv
): Promise<number> {
  if (!isHookName(name)) {
    io.err.write(`hook desconhecido: ${name ?? '(vazio)'}. Use ${HOOK_NAMES.join(' ou ')}.\n`);
    return 1;
  }

  const input = parseHookInput(await readAll(io.input));
  if (!input) {
    io.err.write(`hook ${name}: entrada nao e JSON. Nada injetado.\n`);
    return 0;
  }

  try {
    const out = await HOOKS[name](input, { env });
    if (out) io.output.write(`${JSON.stringify(out)}\n`);
  } catch (e) {
    // Um hook que falha nao pode travar a sessao: o host segue sem o contexto.
    io.err.write(`hook ${name}: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  return 0;
}

export async function runCli(
  argv: string[],
  io: CliIo,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const [cmd, sub] = argv;

  switch (cmd) {
    case 'mcp': {
      const { handler } = createHandler({ env });
      await serveStdio({ input: io.input, output: io.output, err: io.err }, handler);
      return 0;
    }

    case 'hook':
      return runHook(sub, io, env);

    case '--version':
    case '-v':
    case 'version':
      io.output.write(`${VERSION}\n`);
      return 0;

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      io.output.write(HELP);
      return 0;

    default:
      io.err.write(`comando desconhecido: ${cmd}\n\n`);
      io.output.write(HELP);
      return 1;
  }
}
