import { describe, expect, it } from 'bun:test';
import type { Context } from '@opencode/plugin/tui/context';
import plugin, {
  bindListener,
  bindRef,
  handleBind,
  isMilestoneWorktree,
  milestoneOf,
  worktreeName,
} from './tui';

type Part = Parameters<typeof handleBind>[2];
type Event = Parameters<ReturnType<typeof bindListener>>[0];

function part(input: { milestone?: string } = {}, text = ''): Part {
  return {
    type: 'tool',
    id: 'call_1',
    name: 'issue_bind',
    state: {
      status: 'completed',
      input,
      content: [{ type: 'text', text }],
    },
    time: { created: 1 },
  } as unknown as Part;
}

function event(p: Part, sessionID = 'ses_1'): Event {
  return {
    type: 'session.tool.success',
    data: {
      sessionID,
      assistantMessageID: 'msg_1',
      id: p.id,
      content: p.state.status === 'completed' ? p.state.content : [],
      executed: true,
    },
  } as unknown as Event;
}

type Calls = {
  create: unknown[];
  move: unknown[];
  pty: unknown[];
  dispatch: string[];
  select: Array<{ title: string; options: Array<{ title: string }> }>;
  toast: Array<{ message: string }>;
};

function makeContext(
  input: {
    choice?: 'new' | 'reuse' | 'terminal' | 'none';
    worktrees?: Array<{ directory: string }>;
    siblings?: Array<{ id: string; location: { directory: string } }>;
    active?: Record<string, { type: 'running' }>;
    commands?: Array<{ id: string; title: string }>;
    route?: { type: 'session'; sessionID: string } | { type: 'home' };
    focus?: boolean;
    message?: Part;
  } = {}
): { context: Context; calls: Calls } {
  const calls: Calls = { create: [], move: [], pty: [], dispatch: [], select: [], toast: [] };
  const session = { id: 'ses_1', projectID: 'prj_1', location: { directory: '/repo' } };
  const assistant = {
    id: 'msg_1',
    type: 'assistant',
    content: input.message ? [input.message] : [],
  };
  const context = {
    data: {
      on: () => () => {},
      session: {
        get: (id: string) => (id === 'ses_1' ? session : undefined),
        sync: async () => {},
        message: {
          get: (sessionID: string, messageID: string) =>
            sessionID === 'ses_1' && messageID === 'msg_1' ? assistant : undefined,
          sync: async () => {},
        },
      },
    },
    client: {
      worktree: {
        list: async () => input.worktrees ?? [],
        create: async (args: { name: string }) => {
          calls.create.push(args);
          return { directory: `/wt/${args.name}` };
        },
      },
      session: {
        list: async () => ({ data: input.siblings ?? [], cursor: {} }),
        active: async () => input.active ?? {},
        move: async (args: unknown) => void calls.move.push(args),
      },
      experimental: {
        persistentPty: {
          list: async () => [],
          create: async (args: unknown) => {
            calls.pty.push(args);
            return args;
          },
        },
      },
    },
    ui: {
      dialog: {
        select: async (options: Calls['select'][number]) => {
          calls.select.push(options);
          return input.choice ?? 'new';
        },
      },
      toast: { show: (toast: { message: string }) => void calls.toast.push(toast) },
      router: {
        current: () => input.route ?? { type: 'session', sessionID: 'ses_1' },
      },
      tabs: { focus: () => input.focus ?? true },
    },
    keymap: {
      commands: () => input.commands ?? [{ id: 'terminal.toggle', title: 'Show terminal pane' }],
      dispatch: (id: string) => void calls.dispatch.push(id),
    },
  };
  return { context: context as unknown as Context, calls };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('milestoneOf', () => {
  it('usa o marco do input, que sobrescreve a issue', () => {
    expect(milestoneOf(part({ milestone: 'Epsilon' }, '  marco: Beta'))).toBe('Epsilon');
  });

  it('cai na linha marco da saida', () => {
    expect(milestoneOf(part({}, 'Vinculado\n  marco: Ação e Cia\n  status: aberta'))).toBe(
      'Ação e Cia'
    );
  });

  it('sem marco devolve vazio', () => {
    expect(milestoneOf(part({}, '#7 [open] sem marco'))).toBe('');
  });

  it('ignora tool que nao terminou', () => {
    const p = { ...part(), state: { status: 'running' } } as unknown as Part;
    expect(milestoneOf(p)).toBe('');
  });
});

describe('worktreeName', () => {
  it('vira slug com prefixo marco', () => {
    expect(worktreeName('Ação & Cia / 2')).toBe('marco-acao-cia-2');
  });

  it('marco vazio ainda tem nome', () => {
    expect(worktreeName('')).toBe('marco-sem-nome');
  });

  it('limita o tamanho e nao termina com hifen', () => {
    const name = worktreeName('a'.repeat(60));
    expect(name.length).toBeLessThanOrEqual(46);
    expect(name.endsWith('-')).toBe(false);
  });
});

describe('isMilestoneWorktree', () => {
  it('casa o nome base e o sufixo de colisao', () => {
    expect(isMilestoneWorktree('/wt/marco-beta', 'marco-beta')).toBe(true);
    expect(isMilestoneWorktree('/wt/marco-beta-2', 'marco-beta')).toBe(true);
  });

  it('nao casa outro marco', () => {
    expect(isMilestoneWorktree('/wt/marco-beta2', 'marco-beta')).toBe(false);
    expect(isMilestoneWorktree('/wt/marco-gama', 'marco-beta')).toBe(false);
  });
});

describe('handleBind', () => {
  it('cria worktree, move a sessao e abre o nvim', async () => {
    const { context, calls } = makeContext();
    await handleBind(context, 'ses_1', part({}, '  marco: Beta'));

    expect(calls.select[0].title).toBe('Marco "Beta"');
    expect(calls.create).toEqual([{ projectID: 'prj_1', name: 'marco-beta' }]);
    expect(calls.move).toEqual([{ sessionID: 'ses_1', directory: '/wt/marco-beta' }]);
    expect(calls.pty).toEqual([
      {
        sessionID: 'ses_1',
        command: 'nvim',
        args: [],
        cwd: '/wt/marco-beta',
        title: 'nvim: Beta',
        env: { TERM: 'xterm-256color' },
      },
    ]);
    expect(calls.dispatch).toEqual(['terminal.toggle']);
  });

  it('reusa worktree livre', async () => {
    const { context, calls } = makeContext({
      choice: 'reuse',
      worktrees: [{ directory: '/wt/marco-beta' }],
    });
    await handleBind(context, 'ses_1', part({}, '  marco: Beta'));

    expect(calls.create).toHaveLength(0);
    expect(calls.move).toEqual([{ sessionID: 'ses_1', directory: '/wt/marco-beta' }]);
    expect(calls.dispatch).toEqual(['terminal.toggle']);
  });

  it('com worktree em uso, oferece criar outra primeiro', async () => {
    const { context, calls } = makeContext({
      choice: 'none',
      worktrees: [{ directory: '/wt/marco-beta' }],
      siblings: [{ id: 'ses_2', location: { directory: '/wt/marco-beta' } }],
      active: { ses_2: { type: 'running' } },
    });
    await handleBind(context, 'ses_1', part({}, '  marco: Beta'));

    expect(calls.select[0].options[0].title).toBe('Criar outra worktree');
    expect(calls.create).toHaveLength(0);
    expect(calls.move).toHaveLength(0);
    expect(calls.pty).toHaveLength(0);
  });

  it('so abre o terminal no diretorio atual quando nao quer worktree', async () => {
    const { context, calls } = makeContext({ choice: 'terminal' });
    await handleBind(context, 'ses_1', part({}, '  marco: Beta'));

    expect(calls.create).toHaveLength(0);
    expect(calls.move).toHaveLength(0);
    expect(calls.pty[0]).toMatchObject({ cwd: '/repo', command: 'nvim' });
  });

  it('fecha o painel antes de mostrar o nvim quando ele ja esta aberto', async () => {
    const { context, calls } = makeContext({
      commands: [{ id: 'terminal.toggle', title: 'Hide terminal pane' }],
    });
    await handleBind(context, 'ses_1', part({}, '  marco: Beta'));

    expect(calls.dispatch).toEqual(['terminal.close', 'terminal.toggle']);
  });

  it('nada acontece sem marco', async () => {
    const { context, calls } = makeContext();
    await handleBind(context, 'ses_1', part({}, '#7 [open] sem marco'));

    expect(calls.select).toHaveLength(0);
    expect(calls.create).toHaveLength(0);
  });
});

describe('bindRef', () => {
  it('extrai a referencia do texto explicito do bind', () => {
    expect(bindRef(part({}, 'A PARTIR DE AGORA esta sessao esta vinculada a org/repo#7.'))).toBe(
      'org/repo#7'
    );
  });

  it('sem a linha explicita, devolve vazio', () => {
    expect(bindRef(part({}, '#7 [open] sem linha'))).toBe('');
  });
});

describe('bindListener', () => {
  it('processa o mesmo bind uma vez e avisa o usuario', async () => {
    const p = part({}, 'A PARTIR DE AGORA esta sessao esta vinculada a org/repo#7.\n  marco: Beta');
    const { context, calls } = makeContext({ message: p });
    const listener = bindListener(context);
    const e = event(p);

    listener(e);
    listener(e);
    await flush();

    expect(calls.toast[0]?.message).toContain('Sessao vinculada a org/repo#7');
    expect(calls.toast[0]?.message).toContain('/goal');
    expect(calls.select).toHaveLength(1);
    expect(calls.create).toHaveLength(1);
  });

  it('avisa o bind mesmo sem marco', async () => {
    const p = part({}, 'A PARTIR DE AGORA esta sessao esta vinculada a org/repo#7.');
    const { context, calls } = makeContext({ message: p });

    bindListener(context)(event(p));
    await flush();

    expect(calls.toast[0]?.message).toContain('org/repo#7');
    expect(calls.select).toHaveLength(0);
  });

  it('ignora o sucesso de outra tool', async () => {
    const p = { ...part({}, '  marco: Beta'), name: 'issue_view' } as unknown as Part;
    const { context, calls } = makeContext({ message: p });

    bindListener(context)(event(p));
    await flush();

    expect(calls.select).toHaveLength(0);
    expect(calls.create).toHaveLength(0);
    expect(calls.toast).toHaveLength(0);
  });
});

describe('plugin', () => {
  it('escuta o tool success e devolve cleanup', () => {
    const { context } = makeContext();
    const types: string[] = [];
    let off = false;
    (context.data as unknown as { on: (type: string, handler: () => void) => () => void }).on = (
      type
    ) => {
      types.push(type);
      return () => {
        off = true;
      };
    };

    const cleanup = plugin.setup(context);
    expect(types).toEqual(['session.tool.success']);
    if (typeof cleanup === 'function') cleanup();
    expect(off).toBe(true);
  });
});
