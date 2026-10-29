import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { bindingFile, readBinding, writeBinding } from '../core/binding';

/**
 * Qual sessao o processo do Claude Code esta rodando agora.
 *
 * O servidor MCP nasce com `CLAUDE_CODE_SESSION_ID` no ambiente e fica com esse
 * valor ate morrer. Depois de `/clear` o Claude troca de sessao no mesmo
 * processo, e o `tools/call` nao diz qual e a sessao nova. O hook diz: recebe
 * `session_id` no stdin e `CLAUDE_PID` no ambiente. Entao o hook grava um
 * ponteiro `pid do claude -> sessao atual`, e o servidor MCP, filho desse mesmo
 * processo, sobe pelos pais ate achar o ponteiro.
 */

/** Quantos pais o servidor sobe. `claude -> npm exec -> node` sao dois. */
export const MAX_ANCESTORS = 4;

/** Le o pai de um processo. `undefined` quando o sistema nao responde. */
export type ParentOf = (pid: number) => number | undefined;

/** Pai pelo `/proc` no Linux, e por `ps` onde nao ha `/proc` (macOS). */
export const parentPid: ParentOf = (pid) => {
  const status = `/proc/${pid}/status`;
  if (existsSync(status)) {
    try {
      const m = /^PPid:\s+(\d+)/m.exec(readFileSync(status, 'utf8'));
      return m ? Number(m[1]) : undefined;
    } catch {
      // o processo saiu entre o existsSync e a leitura
      return undefined;
    }
  }
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 2000,
  });
  if (r.status !== 0) return undefined;
  const n = Number(r.stdout.trim());
  return Number.isInteger(n) && n > 1 ? n : undefined;
};

function pointerFile(projectDir: string, pid: number, stateDir: string): string {
  return bindingFile(projectDir, `proc-${pid}`, stateDir);
}

function readPointer(projectDir: string, pid: number, stateDir: string): string | undefined {
  const f = pointerFile(projectDir, pid, stateDir);
  if (!existsSync(f)) return undefined;
  try {
    const v = JSON.parse(readFileSync(f, 'utf8')) as { session?: unknown };
    return typeof v?.session === 'string' && v.session ? v.session : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Grava a sessao atual do processo `claudePid` e devolve a anterior. Se a
 * anterior era outra (o `/clear` acabou de trocar), o vinculo dela passa para a
 * nova, para o `/clear` nao desfazer o vinculo.
 */
export function trackSession(
  projectDir: string,
  stateDir: string,
  claudePid: number,
  sessionID: string
): string | undefined {
  const prev = readPointer(projectDir, claudePid, stateDir);
  if (prev === sessionID) return prev;

  const f = pointerFile(projectDir, claudePid, stateDir);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify({ session: sessionID })}\n`);

  if (prev && !readBinding(projectDir, sessionID, stateDir)) {
    const b = readBinding(projectDir, prev, stateDir);
    if (b) writeBinding(projectDir, sessionID, b, stateDir);
  }
  return prev;
}

/**
 * Sessao atual vista do servidor MCP: o ponteiro do pai mais proximo que tem um.
 * `undefined` quando nenhum pai tem, e quem chama cai no ambiente.
 */
export function currentSession(
  projectDir: string,
  stateDir: string,
  pid: number,
  parentOf: ParentOf = parentPid
): string | undefined {
  let p: number | undefined = pid;
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    p = parentOf(p);
    if (!p || p <= 1) return undefined;
    const s = readPointer(projectDir, p, stateDir);
    if (s) return s;
  }
  return undefined;
}

/** `CLAUDE_PID` do ambiente do hook, quando e um pid valido. */
export function claudePid(env: NodeJS.ProcessEnv): number | undefined {
  const n = Number(env.CLAUDE_PID?.trim());
  return Number.isInteger(n) && n > 1 ? n : undefined;
}
