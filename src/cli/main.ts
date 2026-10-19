#!/usr/bin/env node
import { runCli } from './run';

/**
 * Entrada do binario. O Claude Code sobe este processo duas vezes: uma como
 * servidor MCP e uma por evento de hook. Nada aqui pode importar `src/index.ts`,
 * que arrasta o plugin do opencode para dentro deste processo.
 */

const code = await runCli(process.argv.slice(2), {
  input: process.stdin,
  output: process.stdout,
  err: process.stderr,
});

process.exitCode = code;
