import type { OpenCodeEvent, SessionMessageAssistantTool } from '@opencode/client';
import type { Context } from '@opencode/plugin/tui/context';
import type { Definition } from '@opencode/plugin/tui/plugin';

/**
 * Parte TUI do pyatiletka.
 *
 * No bind de uma issue com marco, pergunta o que fazer e, se o usuario mandar,
 * cria ou reusa a worktree do marco, move a sessao para ela e abre o nvim no
 * terminal persistente do opencode.
 *
 * O gatilho e o evento `session.tool.success` do `issue_bind`: o marco vem do
 * input da tool ou da linha `marco:` da saida. A parte servidor nao muda.
 *
 * O `question` e uma tool do modelo e nao pode ser chamado por um plugin, entao
 * a pergunta usa o dialogo nativo da TUI. So existe no opencode v2 com terminais
 * persistentes.
 */

const BIND_TOOLS = new Set(['issue_bind', 'issue.bind']);
const WORKTREE_PREFIX = 'marco-';
const NVIM = 'nvim';
const TERMINAL_TOGGLE = 'terminal.toggle';
const TERMINAL_CLOSE = 'terminal.close';

type ToolSuccess = Extract<OpenCodeEvent, { type: 'session.tool.success' }>;
type ToolPart = SessionMessageAssistantTool;
type Choice = 'new' | 'reuse' | 'terminal' | 'none';

/** O marco que o bind gravou. O input manda, senao a linha `marco:` da saida. */
export function milestoneOf(part: ToolPart): string {
  if (part.state.status !== 'completed') return '';
  const input = part.state.input as { milestone?: unknown };
  const explicit = typeof input.milestone === 'string' ? input.milestone.trim() : '';
  if (explicit) return explicit;
  const text = part.state.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return /^[ \t]*marco:[ \t]*(.+?)[ \t]*$/m.exec(text)?.[1]?.trim() ?? '';
}

/** Nome da worktree do marco. O opencode acrescenta sufixo quando o nome colide. */
export function worktreeName(milestone: string): string {
  const slug = milestone
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${WORKTREE_PREFIX}${slug || 'sem-nome'}`;
}

/** A worktree do marco tem o nome base ou o sufixo de colisao gerado pelo opencode. */
export function isMilestoneWorktree(directory: string, base: string): boolean {
  const name = directory.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return name === base || name.startsWith(`${base}-`);
}

/** A referencia `repo#n` do texto explicito devolvido pelo `issue_bind`. */
export function bindRef(part: ToolPart): string {
  if (part.state.status !== 'completed') return '';
  const text = part.state.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return /A PARTIR DE AGORA esta sessao esta vinculada a (\S+#\d+)/.exec(text)?.[1] ?? '';
}

export async function handleBind(
  context: Context,
  sessionID: string,
  part: ToolPart
): Promise<void> {
  const milestone = milestoneOf(part);
  if (!milestone) return;

  let session = context.data.session.get(sessionID);
  if (!session) {
    await context.data.session.sync(sessionID).catch(() => {});
    session = context.data.session.get(sessionID);
  }
  if (!session || session.parentID) return;

  const projectID = session.projectID;
  const current = session.location.directory;
  const existing = await milestoneWorktrees(context, projectID, milestone);
  const reuse = existing.at(-1);
  const busy = reuse ? await busyAt(context, reuse, sessionID).catch(() => false) : false;

  const choice = await context.ui.dialog.select<Choice>({
    title: `Marco "${milestone}"`,
    options: optionsFor(reuse, busy),
  });
  if (!choice || choice === 'none') return;

  let target = current;
  if (choice === 'new') {
    const created = await context.client.worktree.create({
      projectID,
      name: worktreeName(milestone),
    });
    target = created.directory;
    context.ui.toast.show({
      sessionID,
      title: 'Worktree',
      message: `Criada em ${target}`,
      variant: 'success',
    });
  } else if (choice === 'reuse' && reuse) {
    target = reuse;
  }

  if (target !== current) {
    await context.client.session.move({ sessionID, directory: target });
  }
  await openNvim(context, sessionID, target, milestone);
}

/**
 * O listener do TUI. O evento de sucesso nao carrega o nome da tool, entao a
 * parte do `issue_bind` e lida da mensagem do assistente pelo callID. Um bind
 * por vez: binds que chegam durante uma pergunta entram na fila.
 */
export function bindListener(context: Context): (event: ToolSuccess) => void {
  const seen = new Set<string>();
  const queue: Array<{ sessionID: string; part: ToolPart }> = [];
  let busy = false;

  const drain = async (): Promise<void> => {
    if (busy) return;
    const next = queue.shift();
    if (!next) return;
    busy = true;
    try {
      await handleBind(context, next.sessionID, next.part);
    } catch (error) {
      context.ui.toast.show({
        sessionID: next.sessionID,
        title: 'pyatiletka',
        message: error instanceof Error ? error.message : String(error),
        variant: 'error',
      });
    } finally {
      busy = false;
      void drain();
    }
  };

  return (event) => {
    if (seen.has(event.data.id)) return;
    seen.add(event.data.id);
    void (async () => {
      const part = await completedBind(context, event);
      if (!part) return;
      const ref = bindRef(part);
      if (ref) {
        context.ui.toast.show({
          sessionID: event.data.sessionID,
          title: 'pyatiletka',
          message: `Sessao vinculada a ${ref}. /goal definido para esta issue.`,
          variant: 'info',
        });
      }
      if (!milestoneOf(part)) return;
      queue.push({ sessionID: event.data.sessionID, part });
      void drain();
    })();
  };
}

const plugin: Definition = {
  id: 'pyatiletka.tui',
  setup(context) {
    const off = context.data.on('session.tool.success', bindListener(context));
    return () => off();
  },
};

export default plugin;

/** A parte do `issue_bind` na mensagem do assistente, ja concluida. */
async function completedBind(context: Context, event: ToolSuccess): Promise<ToolPart | undefined> {
  const find = (): ToolPart | undefined => {
    const message = context.data.session.message.get(
      event.data.sessionID,
      event.data.assistantMessageID
    );
    if (message?.type !== 'assistant') return undefined;
    return message.content.find((c): c is ToolPart => c.type === 'tool' && c.id === event.data.id);
  };

  let part = find();
  for (let i = 0; !part && i < 4; i++) {
    await context.data.session.message.sync(event.data.sessionID).catch(() => {});
    await wait(50);
    part = find();
  }
  if (!part || part.state.status !== 'completed' || !BIND_TOOLS.has(part.name)) {
    return undefined;
  }
  return part;
}

function optionsFor(reuse: string | undefined, busy: boolean) {
  if (!reuse) {
    return [
      { title: 'Criar worktree e abrir nvim', value: 'new' as const },
      {
        title: 'Só abrir o nvim',
        value: 'terminal' as const,
        description: 'Sem worktree, no diretorio atual',
      },
      { title: 'Não fazer nada', value: 'none' as const },
    ];
  }
  if (busy) {
    return [
      {
        title: 'Criar outra worktree',
        value: 'new' as const,
        description: `${reuse} ja esta em uso`,
      },
      { title: 'Reusar mesmo assim', value: 'reuse' as const, description: reuse },
      { title: 'Não fazer nada', value: 'none' as const },
    ];
  }
  return [
    { title: 'Reusar worktree e abrir nvim', value: 'reuse' as const, description: reuse },
    { title: 'Criar outra worktree', value: 'new' as const },
    { title: 'Não fazer nada', value: 'none' as const },
  ];
}

async function milestoneWorktrees(
  context: Context,
  projectID: string,
  milestone: string
): Promise<string[]> {
  const base = worktreeName(milestone);
  const list = await context.client.worktree.list({ projectID });
  return list.map((w) => w.directory).filter((d) => isMilestoneWorktree(d, base));
}

/** Worktree ocupada por outra sessao rodando, que e o caso de dois trabalhos em paralelo. */
async function busyAt(context: Context, directory: string, sessionID: string): Promise<boolean> {
  const [sessions, active] = await Promise.all([
    context.client.session.list({ directory, limit: 50 }),
    context.client.session.active(),
  ]);
  return sessions.data.some((s) => s.id !== sessionID && !s.parentID && active[s.id] !== undefined);
}

async function openNvim(
  context: Context,
  sessionID: string,
  directory: string,
  milestone: string
): Promise<void> {
  const terminals = await context.client.experimental.persistentPty
    .list({ sessionID })
    .catch(() => []);
  const latest = terminals.at(-1);
  const running =
    latest !== undefined &&
    latest.status === 'running' &&
    latest.cwd === directory &&
    latest.command.endsWith(NVIM);

  if (!running) {
    await context.client.experimental.persistentPty.create({
      sessionID,
      command: NVIM,
      args: [],
      cwd: directory,
      title: `${NVIM}: ${milestone}`,
      env: { TERM: 'xterm-256color' },
    });
  }
  await showTerminal(context, sessionID, directory);
}

/** Mostra o painel do `/terminal`, que sempre exibe o PTY mais novo da sessao. */
async function showTerminal(context: Context, sessionID: string, directory: string): Promise<void> {
  const route = context.ui.router.current();
  if (route.type !== 'session' || route.sessionID !== sessionID) {
    if (!context.ui.tabs.focus(sessionID)) {
      context.ui.toast.show({
        sessionID,
        title: 'Terminal',
        message: `nvim aberto em ${directory}. Abra a sessao para ver o painel.`,
        variant: 'info',
      });
      return;
    }
    await wait(50);
  }

  let toggle = context.keymap.commands().find((c) => c.id === TERMINAL_TOGGLE);
  for (let i = 0; !toggle && i < 10; i++) {
    await wait(50);
    toggle = context.keymap.commands().find((c) => c.id === TERMINAL_TOGGLE);
  }
  if (!toggle) {
    context.ui.toast.show({
      sessionID,
      title: 'Terminal',
      message: `nvim aberto em ${directory}. O painel de terminal nao esta disponivel nesta TUI.`,
      variant: 'warning',
    });
    return;
  }

  // Fechar antes abre espaco para o `/terminal` selecionar o PTY recem-criado.
  if (/hide/i.test(toggle.title ?? '')) {
    context.keymap.dispatch(TERMINAL_CLOSE);
    await wait(20);
  }
  context.keymap.dispatch(TERMINAL_TOGGLE);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
