/**
 * Stub do `Plugin.Context` do opencode v2. Captura as tools, os hooks e o
 * storage para o teste exercitar o adaptador sem o host.
 */

export type FakeToolRegistration = {
  name: string;
  namespace: string;
  description: string;
  input: Record<string, unknown>;
  execute: (
    input: unknown,
    ctx: { sessionID: string; signal: AbortSignal }
  ) => Promise<{ content: unknown }>;
};

export type FakeHook = (event: Record<string, unknown>) => Promise<void> | void;

type Editor = {
  namespace(ns: { name: string; description: string }): void;
  add(info: {
    name: string;
    description: string;
    input: Record<string, unknown>;
    execute: FakeToolRegistration['execute'];
  }): void;
};

export class FakePluginContext {
  readonly tools: FakeToolRegistration[] = [];
  readonly namespaces: { name: string; description: string }[] = [];
  readonly sessionHooks = new Map<string, FakeHook>();
  readonly toolHooks = new Map<string, FakeHook>();
  readonly entries = new Map<string, unknown>();
  readonly location = {
    directory: '/w',
    project: { id: 'proj', directory: '/w', canonical: '/w' },
  };
  options: Record<string, unknown> = {};
  readonly sessions = new Map<string, { title?: string; parentID?: string }>();
  readonly sessionUpdates: Array<{ sessionID: string; title?: string }> = [];
  readonly sessionCommands: Array<{
    sessionID: string;
    name: string;
    text: string;
    delivery?: string;
  }> = [];

  private currentNamespace = '';

  readonly tool = {
    transform: async (cb: (editor: Editor) => void) => {
      const editor: Editor = {
        namespace: (ns) => {
          this.currentNamespace = ns.name;
          this.namespaces.push(ns);
        },
        add: (info) => {
          this.tools.push({ ...info, namespace: this.currentNamespace });
        },
      };
      cb(editor);
      return { dispose: async () => {} };
    },
    hook: async (name: string, cb: FakeHook) => {
      this.toolHooks.set(name, cb);
      return { dispose: async () => {} };
    },
  };

  readonly session = {
    hook: async (name: string, cb: FakeHook) => {
      this.sessionHooks.set(name, cb);
      return { dispose: async () => {} };
    },
    get: async (input: { sessionID: string }) => {
      const session = this.sessions.get(input.sessionID);
      return session
        ? { id: input.sessionID, ...session }
        : { id: input.sessionID, title: undefined, parentID: undefined };
    },
    update: async (input: { sessionID: string; title?: string }) => {
      this.sessionUpdates.push(input);
      if (input.title === undefined) return;
      const current = this.sessions.get(input.sessionID) ?? {};
      this.sessions.set(input.sessionID, { ...current, title: input.title });
    },
    command: async (input: {
      sessionID: string;
      name: string;
      text: string;
      delivery?: string;
    }) => {
      this.sessionCommands.push(input);
    },
  };

  readonly storage = {
    get: async (key: string): Promise<unknown> => this.entries.get(key),
    set: async (key: string, value: unknown): Promise<void> => {
      this.entries.set(key, value);
    },
    remove: async (key: string): Promise<void> => {
      this.entries.delete(key);
    },
    scan: async () => ({ entries: [] as { key: string; value: unknown }[] }),
  };
}
