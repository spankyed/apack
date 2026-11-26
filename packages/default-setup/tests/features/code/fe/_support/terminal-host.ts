// What a terminal host is mounted inside: a window @apackdev/state system providing the `'default-setup/code'`
// surface and its `terminal` and `explorer` children so Vue components using `#generated/state-fe.ts` mount cleanly.
import { ref, createApp, h, nextTick, type App, type Component, type Ref } from 'vue';
import { state, system, type AnyEvent } from '@apackdev/state';
import { fakeSettings, startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import { bindSettings } from '#generated/settings-fe.ts';
import { provide as providePackState } from '#generated/state-fe.ts';
import type { CodeSettings } from '#generated/types.ts';
import type { TerminalActivity, TerminalInfo, TerminalRewindView } from '#features/code/fe/features/terminal/state.ts';

/** The ref the code surface runs under, which is what a settings target names it by */
export const CODE_SURFACE = 'default-setup/code';

export interface OpenFile {
  path: string;
  isTerminal?: boolean;
}

export interface CodeSurfaceOptions {
  terminals?: TerminalInfo[];
  panelTerminalId?: string | null;
  panelTerminalExpanded?: boolean;
  openFiles?: OpenFile[];
  settings?: Partial<CodeSettings>;
}

export interface CodeSurfaceHarness {
  /** The element the component tree is mounted into */
  readonly root: HTMLElement;
  /** Every event a host sent the terminal child, in the order it sent them */
  readonly sent: AnyEvent[];
  /** Mounts `component` with the provided code state system; the ref is its exposed members */
  mount<T>(component: Component, props?: Record<string, unknown>): Ref<T | undefined>;
  /** The terminal list the backend published, as the child state holds it */
  setTerminals(terminals: TerminalInfo[]): Promise<void>;
  /** What each terminal's program has said off its screen, as the child state holds it */
  setActivity(activity: Record<string, TerminalActivity>): Promise<void>;
  /** The bells the terminal child holds as flashing or in their window, as the state keeps them */
  setBells(bells: Record<string, 'flashing' | 'quiet'>): Promise<void>;
  /** The recording this window has open to look back through, or none */
  setRewind(rewind: TerminalRewindView | null): Promise<void>;
  selectPanelTerminal(terminalId: string | null): Promise<void>;
  togglePanel(): Promise<void>;
  /** Vue's queue and the panel's watcher, which attaches a tick after a change */
  settle(): Promise<void>;
  /** Unmounts the host alone, which is what a tab switch or a panel drag does to it */
  unmount(): void;
  stop(): void;
}

/** A terminal, with the fields a host reads */
export const terminalInfo = (id: TerminalInfo['id'], fields: Partial<TerminalInfo> = {}): TerminalInfo => ({
  // The session a window draws it from, which every running terminal has; a case about one that ended passes none
  id, session: `session-of-${id}`, title: 'zsh', pid: 4242, shell: '/bin/zsh', cwd: '/tmp', active: true, generation: 1, cols: 80, rows: 24,
  // The host's number, as a session carries it; a case that cares about the bound passes its own
  submit: '\n',
  ...fields,
});

const TERMINAL_EVENT_TYPES = [
  'terminal.CREATE',
  'terminal.CLOSE',
  'terminal.RESTART',
  'terminal.INPUT',
  'terminal.DETACHED',
  'terminal.RESIZE',
  'terminal.RENAME',
  'terminal.REFRESH_LIST',
  'terminal.SEEN',
  'terminal.KEEP',
  'terminal.REWIND',
  'terminal.REWIND_SEEK',
  'terminal.REWIND_CLOSE',
  'terminal.REWIND_RESIZE',
  'terminal.FAILURES_TOLD',
] as const;

export function startCodeSurface(options: CodeSurfaceOptions = {}): CodeSurfaceHarness {
  const sent: AnyEvent[] = [];

  const recordHandlers: Record<string, (ev: AnyEvent) => void> = {};
  for (const type of TERMINAL_EVENT_TYPES) {
    recordHandlers[type] = (ev) => {
      sent.push(ev);
    };
  }

  type FakeTerminalEvent =
    | { type: (typeof TERMINAL_EVENT_TYPES)[number]; [key: string]: unknown }
    | { type: 'test.TERMINALS'; terminals: TerminalInfo[] }
    | { type: 'test.ACTIVITY'; activity: Record<string, TerminalActivity> }
    | { type: 'test.REWIND'; rewind: TerminalRewindView | null }
    | { type: 'test.BELLS'; bells: Record<string, 'flashing' | 'quiet'> };

  const fakeTerminal = state<{
    data: {
      terminals: TerminalInfo[];
      activity: Record<string, TerminalActivity>;
      rewind: TerminalRewindView | null;
      bells: Record<string, 'flashing' | 'quiet'>;
      failures: Array<{ message: string }>;
    };
  }, FakeTerminalEvent>()({
    data: {
      terminals: options.terminals ?? [],
      activity: {},
      rewind: null,
      bells: {},
      failures: [],
    },
    on: {
      ...(recordHandlers as Record<string, (ev: FakeTerminalEvent) => void>),
      'test.TERMINALS': (ev) => ({ data: { terminals: [...(ev.terminals as TerminalInfo[])] } }),
      'test.ACTIVITY': (ev) => ({ data: { activity: { ...(ev.activity as Record<string, TerminalActivity>) } } }),
      'test.REWIND': (ev) => ({ data: { rewind: ev.rewind as TerminalRewindView | null } }),
      'test.BELLS': (ev) => ({ data: { bells: { ...(ev.bells as Record<string, 'flashing' | 'quiet'>) } } }),
    },
  });

  const fakeExplorer = state<{}, { type: 'explorer.OPEN_FILE'; path: string }>()({
    on: {
      'explorer.OPEN_FILE': (ev) => {
        sent.push(ev);
      },
    },
  });

  type FakeCodeEvent =
    | { type: 'SELECT_PANEL_TERMINAL'; terminalId: string | null }
    | { type: 'TOGGLE_PANEL_TERMINAL' }
    | { type: 'UPDATE_STATE'; updates: Record<string, unknown> }
    | { type: 'OPEN_TERMINAL_IN_TAB'; terminalId: string }
    | { type: 'MOVE_TERMINAL_TO_PANEL'; path: string };

  const fakeCode = state<{
    data: {
      panelTerminalId: string | null;
      panelTerminalExpanded: boolean;
      openFiles: OpenFile[];
      settings: CodeSettings;
    };
    starts: {
      terminal: typeof fakeTerminal;
      explorer: typeof fakeExplorer;
    };
  }, FakeCodeEvent>()({
    data: {
      panelTerminalId: options.panelTerminalId ?? null,
      panelTerminalExpanded: options.panelTerminalExpanded ?? false,
      openFiles: options.openFiles ?? [],
      settings: (options.settings ?? {}) as CodeSettings,
    },
    starts: () => ({
      terminal: fakeTerminal,
      explorer: fakeExplorer,
    }),
    on: {
      SELECT_PANEL_TERMINAL: ({ terminalId }) => ({
        data: { panelTerminalId: terminalId },
      }),
      TOGGLE_PANEL_TERMINAL: (_ev, { data }) => ({
        data: { panelTerminalExpanded: !data.panelTerminalExpanded },
      }),
      UPDATE_STATE: () => {},
      OPEN_TERMINAL_IN_TAB: () => {},
      MOVE_TERMINAL_TO_PANEL: () => {},
    },
  });

  const sys = system({ side: 'window' });
  const codeHandle = sys.start(CODE_SURFACE, fakeCode);
  const terminalHandle = sys.child(codeHandle, 'terminal');

  const stopRuntime = startFeTestRuntime({});
  const settings = bindSettings(fakeSettings({
    features: { [CODE_SURFACE]: { confirmTerminalClose: false, terminalScripts: [], ...options.settings } },
  }));
  settings.activate();

  const root = document.createElement('div');
  document.body.appendChild(root);
  let app: App | undefined;

  // Three turns: the change, the watcher's own `await nextTick()`, and the render its attach causes
  const settle = async () => { await nextTick(); await nextTick(); await nextTick(); };

  return {
    root,
    sent,
    mount<T>(component: Component, props: Record<string, unknown> = {}) {
      const exposed = ref<T>();
      app = createApp({
        render: () => h(component, { ...props, ref: exposed }),
      });
      providePackState(app, sys);
      app.mount(root);
      return exposed as Ref<T | undefined>;
    },
    async setTerminals(terminals) {
      sys.send(terminalHandle, { type: 'test.TERMINALS', terminals });
      await settle();
    },
    async setActivity(activity) {
      sys.send(terminalHandle, { type: 'test.ACTIVITY', activity });
      await settle();
    },
    async setBells(bells) {
      sys.send(terminalHandle, { type: 'test.BELLS', bells });
      await settle();
    },
    async setRewind(rewind) {
      sys.send(terminalHandle, { type: 'test.REWIND', rewind });
      await settle();
    },
    async selectPanelTerminal(terminalId) {
      sys.send(codeHandle, { type: 'SELECT_PANEL_TERMINAL', terminalId });
      await settle();
    },
    async togglePanel() {
      sys.send(codeHandle, { type: 'TOGGLE_PANEL_TERMINAL' });
      await settle();
    },
    settle,
    unmount() {
      app?.unmount();
      app = undefined;
    },
    stop() {
      app?.unmount();
      app = undefined;
      root.remove();
      settings.dispose();
      sys.stop();
      stopRuntime();
      stopFeTestRuntime();
    },
  };
}
