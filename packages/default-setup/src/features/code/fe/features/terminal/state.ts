import { given, type Each, type Read } from '@apackdev/state';
import { state, type PackNet } from '#generated/state.ts';
import type { CodeSettings } from '#generated/types.ts';
import type { TerminalInfo, TerminalStatus } from '../../../be/types.ts';
import { terminalPool } from '../../utils/terminal-pool.ts';
import { terminalNameFor } from '../../utils/terminal-name.ts';
import { lookedAt, needsLooking, newlyWanting, statusNotification } from './status.ts';

/**
 * **The type the system publishes, not a window's copy of it**, which is why it is imported and re-exported
 * rather than declared here.
 */
export type { TerminalInfo };

type CodeAsks = PackNet['systems']['code']['asks'];

/** How long a bell paints its terminal's flash (Phase 2, D7) */
export const BELL_FLASH_MS = 150;
/**
 * The window in which a bell is the same bell as one already accepted: a bell inside it changes nothing. Measured from the
 * accepted bell, so the flash (150 ms) is followed by the rest of the window (350 ms) before another bell is a new one.
 */
export const BELL_WINDOW_MS = 500;
/**
 * The window in which a terminal's bell notification is not repeated. It is its own gate, separate from the flash's
 * window: a bell that the flash ignores as the same bell can still be a notification of its own once this has closed.
 */
export const BELL_NOTIFY_WINDOW_MS = 1000;

/** The name a recording's view is pooled under, which is not a terminal's and cannot be taken for one */
export const rewindViewId = (session: string) => `rewind:${session}`;

/**
 * What a terminal's program has said that is not on its screen, as its tab shows it.
 *
 * **A program's claims, drawn and never acted on**: a bell and a notification mark the tab until the
 * person looks at the terminal, progress is what the program last said of how far along it is, and
 * `title` is what it last named its terminal.
 */
export interface TerminalActivity {
  bell?: boolean;
  notification?: { title: string; body: string };
  progress?: { state: 'running' | 'error' | 'indeterminate' | 'paused'; percent: number | null };
  title?: string;
}

/** A recording this window has open to look back through */
export interface TerminalRewindView {
  terminalId: string;
  /** What its view is drawn from */
  session: string;
  /** The moments it runs between, and the one it shows, in milliseconds since the Unix epoch */
  first: number;
  last: number;
  at: number;
}

/** An ask of this window's that was not done, as the canvas tells it */
export interface TerminalAskFailure {
  message: string;
}

/** The settings fields this machine reads for bells and status notifications */
export type TerminalBellSettings = Pick<CodeSettings, 'bellFlash' | 'bellNotification' | 'terminalStatusNotification'>;

export interface CodeTerminalData {
  baseDirectory: string;
  settings: Partial<TerminalBellSettings> | undefined;
  terminals: TerminalInfo[];
  /** By terminal, for the ones whose program has said something */
  activity: Record<string, TerminalActivity>;
  /** The recording this window is looking back through, when it is */
  rewind: TerminalRewindView | null;
  /**
   * The bells accepted and still inside their window, by terminal. `flashing` is the terminal's flash, which the view
   * paints; `quiet` is the rest of the window. Each entry is removed by a timer its accepted bell started.
   */
  bells: Record<string, 'flashing' | 'quiet'>;
  /**
   * The terminals whose bell notification was asked for within the last `BELL_NOTIFY_WINDOW_MS`. Each entry is removed by
   * a timer its notification started.
   */
  notifying: Record<string, true>;
  /**
   * The terminals a status notification was raised for and the person has not looked at since.
   */
  statusNotified: Record<string, true>;
  /**
   * This window's asks that were not done, each held until the canvas has told the person.
   */
  failures: readonly TerminalAskFailure[];
}

export type CodeTerminalReport =
  | { type: 'TERMINAL_LIST_LOADED'; terminals: TerminalInfo[] }
  | { type: 'TERMINAL_CREATED_FOR_WINDOW'; terminalInfo: TerminalInfo; target: 'tab' | null }
  | { type: 'TERMINAL_CLOSED_REPORT'; terminalId: string; remainingTerminals: TerminalInfo[] }
  | { type: 'TERMINAL_TAB_INFO_CHANGED'; terminalId: string; changes: Record<string, unknown> }
  | { type: 'TERMINAL_OPEN_TAB_REQUEST'; terminalInfo: TerminalInfo; preserveActive?: boolean };

/** A grid the pty runs at: broadcast when it moved, or the answer to this window's own fit when that was refused */
type TerminalGrid = { terminalId: string; cols: number; rows: number };

type CreateCallInput = {
  args: CodeAsks['terminal.CREATE_TERMINAL']['args'];
  /** `'tab'` routes the created terminal to a canvas tab; otherwise it goes to the panel */
  target: 'tab' | null;
  /** A command to run in it once it exists */
  command: string | null;
};

type BellTimerReport =
  | { type: 'terminal.BELL_FLASH_ENDED'; terminalId: string }
  | { type: 'terminal.BELL_WINDOW_ENDED'; terminalId: string };

type BellNotifyTimerReport = { type: 'terminal.BELL_NOTIFY_WINDOW_ENDED'; terminalId: string };

export type CodeTerminalEvent =
  /** The surface started over its folder: the panel asks for the running terminals */
  | { type: 'CODE_STARTED'; baseDirectory?: string; settings?: Partial<TerminalBellSettings> }
  | { type: 'SYNC_BASE_DIRECTORY'; baseDirectory: string }
  | { type: 'SYNC_SETTINGS'; settings: Partial<TerminalBellSettings> | undefined }
  | { type: 'terminal.CREATE'; title?: string; cwd?: string; target?: 'tab'; command?: string; on?: string }
  | { type: 'terminal.CLOSE'; terminalId: string }
  | { type: 'terminal.RESTART'; terminalId: string }
  | { type: 'terminal.INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE'; terminalId: string; cols: number; rows: number; cellWidth?: number; cellHeight?: number }
  /** This window has stopped drawing that terminal, so its fit should stop holding the grid down */
  | { type: 'terminal.DETACHED'; terminalId: string }
  | { type: 'terminal.RENAME'; terminalId: string; customTitle: string }
  | { type: 'terminal.REFRESH_LIST' }
  | { type: 'terminal.OPEN_TAB'; terminalInfo: TerminalInfo }
  | { type: 'terminal.OPEN_TABS'; terminalIds: string[] }
  | { type: 'terminal.CREATED'; data: { terminalId: string } }
  | { type: 'terminal.CLOSED'; data: { terminalId: string } }
  | { type: 'terminal.CRASHED'; data: { terminalId: string; code: number | null } }
  | { type: 'terminal.RESTARTED'; data: TerminalInfo }
  | { type: 'terminal.RENAMED'; data: { terminalId: string; customTitle: string } }
  | { type: 'terminal.CWD_CHANGED'; data: { terminalId: string; cwd: string; title?: string } }
  | { type: 'terminal.CLIPBOARD'; data: { terminalId: string; text: string } }
  | { type: 'terminal.BELL'; data: { terminalId: string; bellId: string } }
  | { type: 'terminal.NOTIFIED'; data: { terminalId: string; title: string; body: string } }
  | { type: 'terminal.PROGRESS'; data: { terminalId: string; state: 'none' | 'running' | 'error' | 'indeterminate' | 'paused'; percent: number | null } }
  | { type: 'terminal.TITLED'; data: { terminalId: string; title: string } }
  /** What a terminal's programs say they are doing, every record as it stands, and what of it has been seen */
  | { type: 'terminal.STATUS'; data: { terminalId: string; statuses: TerminalStatus[] } }
  /** The person is looking at that terminal: what was waiting for them to is no longer */
  | { type: 'terminal.SEEN'; terminalId: string }
  // The person was told of these failures, which stop being held: the canvas says so as it shows them
  | { type: 'terminal.FAILURES_TOLD'; told: readonly TerminalAskFailure[] }
  | { type: 'terminal.KEEP'; terminalId: string; kept: boolean }
  | { type: 'terminal.KEPT'; data: { terminalId: string; kept: boolean } }
  | { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.REWIND_SEEK'; at: number }
  | { type: 'terminal.REWIND_CLOSE' }
  | { type: 'terminal.REWIND_RESIZE'; cols: number; rows: number }
  | { type: 'terminal.RESIZED'; data: TerminalGrid }
  // Reports from child bell timers
  | (BellTimerReport & { from?: string })
  | (BellNotifyTimerReport & { from?: string });

const bellTimerState = state<
  { data: { terminalId: string; flash: boolean }; reports: BellTimerReport },
  never
>()({
  data: { terminalId: given, flash: given },
  run: async ({ data, sleep, report }) => {
    if (data.flash) {
      await sleep(BELL_FLASH_MS);
      report({ type: 'terminal.BELL_FLASH_ENDED', terminalId: data.terminalId });
      await sleep(BELL_WINDOW_MS - BELL_FLASH_MS);
    } else {
      await sleep(BELL_WINDOW_MS);
    }
    report({ type: 'terminal.BELL_WINDOW_ENDED', terminalId: data.terminalId });
  },
  failed: () => {},
});

const bellNotifyTimerState = state<
  { data: { terminalId: string }; reports: BellNotifyTimerReport },
  never
>()({
  data: { terminalId: given },
  run: async ({ data, sleep, report }) => {
    await sleep(BELL_NOTIFY_WINDOW_MS);
    report({ type: 'terminal.BELL_NOTIFY_WINDOW_ENDED', terminalId: data.terminalId });
  },
  failed: () => {},
});

type CodeTerminalShape = {
  data: CodeTerminalData;
  reports: CodeTerminalReport;
  starts: {
    bellTimers: Each<typeof bellTimerState>;
    notifyTimers: Each<typeof bellNotifyTimerState>;
  };
  calls: {
    list: 'one';
    create: { readonly many: CreateCallInput };
    close: { readonly many: CodeAsks['terminal.CLOSE_TERMINAL']['args'] };
    restart: { readonly many: CodeAsks['terminal.RESTART_TERMINAL']['args'] };
    resize: { readonly many: CodeAsks['terminal.RESIZE_TERMINAL']['args'] };
    rename: { readonly many: CodeAsks['terminal.RENAME_TERMINAL']['args'] };
    openTab: { readonly many: CodeAsks['terminal.OPEN_TERMINAL_TAB']['args'] };
    keep: { readonly many: CodeAsks['terminal.KEEP_TERMINAL']['args'] };
    rewind: { readonly many: CodeAsks['terminal.REWIND']['args'] };
    seek: { readonly many: CodeAsks['terminal.REWIND_SEEK']['args'] };
  };
};

/**
 * Asks the main process to show the system notification a bell asks for. Through the bridge, because a window's own
 * `Notification` is refused while the window is not focused, which is the case this exists for.
 */
export function showBellNotification(bellId: string): void {
  void window.electronAPI?.notify?.show('Terminal', 'Rang the bell', bellId).catch(() => {});
}

/**
 * Asks the main process to tell the person a terminal's program wants them. Through the bridge, as a bell's
 * is, and under a tag so that every window that was not in front raises one between them.
 */
export function showStatusNotification(terminalId: string, terminal: string, record: TerminalStatus): void {
  const { title, body } = statusNotification(terminal, record);
  void window.electronAPI?.notify?.show(title, body, `terminal-status:${terminalId}:${record.id}:${record.changed}`).catch(() => {});
}

function withFailure(failures: readonly Read<TerminalAskFailure>[], message: string): TerminalAskFailure[] {
  return [...failures, { message }];
}

function applyTerminalGrid(terminals: readonly Read<TerminalInfo>[], grid: TerminalGrid): TerminalInfo[] {
  const updated: TerminalInfo[] = terminals.map((terminal) => {
    const clone: TerminalInfo = {
      ...(terminal as TerminalInfo),
      ...(terminal.statuses ? { statuses: terminal.statuses.map((s) => ({ ...s })) } : {}),
    };
    return terminal.id === grid.terminalId ? { ...clone, cols: grid.cols, rows: grid.rows } : clone;
  });
  const described = updated.find((terminal) => terminal.id === grid.terminalId);
  if (described) terminalPool.describe(described);
  return updated;
}

export const terminalState = state<CodeTerminalShape, CodeTerminalEvent>()({
  data: {
    baseDirectory: '',
    settings: undefined,
    terminals: [],
    activity: {},
    rewind: null,
    bells: {},
    notifying: {},
    statusNotified: {},
    failures: [],
  },
  starts: (start) => ({
    bellTimers: start(bellTimerState, {
      each: 'bells',
      given: (terminalId, data) => ({ terminalId, flash: data.bells[terminalId] === 'flashing' }),
    }),
    notifyTimers: start(bellNotifyTimerState, {
      each: 'notifying',
      given: (terminalId) => ({ terminalId }),
    }),
  }),
  calls: ({ one, many }) => ({
    list: one('code', 'terminal.REFRESH_LIST', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) return { data: { failures: withFailure(data.failures, outcome.failure.message) } };
        const terminals = outcome.value;
        // A terminal keeps its id across a backend restart but not its process, so this is where a pool
        // entry learns the shell under it was replaced
        terminalPool.syncProcesses(terminals);
        report({ type: 'TERMINAL_LIST_LOADED', terminals });
        return { data: { terminals } };
      },
    }),
    create: many('code', 'terminal.CREATE_TERMINAL', {
      args: (input) => input.args,
      done: (outcome, { input, data, report, tell }) => {
        if (!outcome.ok) return { data: { failures: withFailure(data.failures, outcome.failure.message) } };
        const terminalInfo = outcome.value;
        report({ type: 'TERMINAL_CREATED_FOR_WINDOW', terminalInfo, target: input.target });
        // Run pending command if set. Ended the way this shell ends a line (X6): a window cannot know
        // which shell is on the other end, so the descriptor carries it.
        if (input.command) {
          tell('code', {
            type: 'terminal.TERMINAL_INPUT',
            terminalId: terminalInfo.id,
            data: input.command + (terminalInfo.submit ?? '\n'),
          });
        }
      },
    }),
    close: many('code', 'terminal.CLOSE_TERMINAL', {
      done: (outcome, { data }) =>
        outcome.ok ? undefined : { data: { failures: withFailure(data.failures, outcome.failure.message) } },
    }),
    restart: many('code', 'terminal.RESTART_TERMINAL', {
      done: (outcome, { data }) =>
        outcome.ok ? undefined : { data: { failures: withFailure(data.failures, outcome.failure.message) } },
    }),
    resize: many('code', 'terminal.RESIZE_TERMINAL', {
      done: (outcome, { data }) => {
        if (!outcome.ok) return { data: { failures: withFailure(data.failures, outcome.failure.message) } };
        // Refused fit answers with the grid the pty runs at instead
        if (outcome.value !== null) {
          return { data: { terminals: applyTerminalGrid(data.terminals, outcome.value) } };
        }
      },
    }),
    rename: many('code', 'terminal.RENAME_TERMINAL', {
      done: (outcome, { data }) =>
        outcome.ok ? undefined : { data: { failures: withFailure(data.failures, outcome.failure.message) } },
    }),
    openTab: many('code', 'terminal.OPEN_TERMINAL_TAB', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) return { data: { failures: withFailure(data.failures, outcome.failure.message) } };
        report({ type: 'TERMINAL_OPEN_TAB_REQUEST', terminalInfo: outcome.value, preserveActive: true });
      },
    }),
    keep: many('code', 'terminal.KEEP_TERMINAL', {
      done: (outcome, { data }) =>
        outcome.ok ? undefined : { data: { failures: withFailure(data.failures, outcome.failure.message) } },
    }),
    rewind: many('code', 'terminal.REWIND', {
      done: (outcome, { data }) => {
        if (!outcome.ok) return { data: { failures: withFailure(data.failures, outcome.failure.message) } };
        const opened = outcome.value;
        if (data.rewind && data.rewind.session !== opened.session) {
          terminalPool.dispose(rewindViewId(data.rewind.session));
        }
        return { data: { rewind: { ...opened, at: opened.last } } };
      },
    }),
    seek: many('code', 'terminal.REWIND_SEEK', {
      done: (outcome, { data }) => {
        if (!outcome.ok) return { data: { failures: withFailure(data.failures, outcome.failure.message) } };
        const sought = outcome.value;
        if (!sought || data.rewind?.session !== sought.session) return;
        return { data: { rewind: { ...data.rewind, at: sought.at } } };
      },
    }),
  }),
  on: {
    CODE_STARTED: (event, { cancel, call }) => {
      cancel('list');
      call('list');
      if (event.baseDirectory !== undefined || event.settings !== undefined) {
        return {
          data: {
            ...(event.baseDirectory !== undefined ? { baseDirectory: event.baseDirectory } : {}),
            ...(event.settings !== undefined ? { settings: event.settings } : {}),
          },
        };
      }
    },
    SYNC_BASE_DIRECTORY: ({ baseDirectory }) => ({ data: { baseDirectory } }),
    SYNC_SETTINGS: ({ settings }) => ({ data: { settings } }),
    'terminal.CREATE': (ev, { data, call }) => {
      const baseDir = data.baseDirectory;
      call('create', {
        args: {
          title: ev.title,
          // `on` is one of the settings' targets: somewhere else, where this machine's directory names nothing
          ...(ev.on === undefined
            ? { cwd: ev.cwd || (baseDir && baseDir.trim() ? baseDir : undefined) }
            : { target: ev.on }),
        },
        target: ev.target ?? null,
        command: ev.command ?? null,
      });
    },
    'terminal.CLOSE': ({ terminalId }, { call }) => {
      call('close', { terminalId });
    },
    'terminal.RESTART': ({ terminalId }, { call }) => {
      call('restart', { terminalId });
    },
    'terminal.INPUT': ({ terminalId, data: inputData }, { tell }) => {
      tell('code', { type: 'terminal.TERMINAL_INPUT', terminalId, data: inputData });
    },
    'terminal.DETACHED': ({ terminalId }, { tell }) => {
      tell('code', { type: 'terminal.STOPPED_FITTING', terminalId });
    },
    'terminal.RESIZE': ({ terminalId, cols, rows, cellWidth, cellHeight }, { call }) => {
      call('resize', { terminalId, cols, rows, cellWidth, cellHeight });
    },
    'terminal.RENAME': ({ terminalId, customTitle }, { call }) => {
      call('rename', { terminalId, customTitle });
    },
    'terminal.REFRESH_LIST': (_event, { cancel, call }) => {
      cancel('list');
      call('list');
    },
    'terminal.OPEN_TAB': ({ terminalInfo }, { report }) => {
      report({ type: 'TERMINAL_OPEN_TAB_REQUEST', terminalInfo });
    },
    'terminal.OPEN_TABS': ({ terminalIds }, { call }) => {
      for (const terminalId of terminalIds) {
        call('openTab', { terminalId });
      }
    },
    // News: a terminal exists in some window. Ask for the list again; nothing else happens.
    'terminal.CREATED': (_event, { cancel, call }) => {
      cancel('list');
      call('list');
    },
    'terminal.CLOSED': ({ data: { terminalId } }, { data, report }) => {
      const remainingTerminals = data.terminals.filter((t) => t.id !== terminalId);
      terminalPool.dispose(terminalId);
      report({ type: 'TERMINAL_CLOSED_REPORT', terminalId, remainingTerminals });
      const { [terminalId]: _gone, ...activity } = data.activity;
      return { data: { terminals: remainingTerminals, activity } };
    },
    'terminal.CRASHED': ({ data: { terminalId, code } }, { data }) => {
      const terminals = data.terminals.map((one) =>
        one.id === terminalId ? { ...one, active: false, exited: { code } } : one,
      );
      const described = terminals.find((t) => t.id === terminalId);
      if (described) terminalPool.describe(described);
      terminalPool.noteExit(terminalId, code);
      return { data: { terminals } };
    },
    'terminal.RESTARTED': ({ data: restarted }, { data }) => {
      const terminals = data.terminals.map((one) => (one.id === restarted.id ? restarted : one));
      const described = terminals.find((t) => t.id === restarted.id);
      if (described) terminalPool.describe(described);
      return { data: { terminals } };
    },
    'terminal.RENAMED': ({ data: { terminalId, customTitle } }, { data, report }) => {
      const terminals = data.terminals.map((t) => (t.id === terminalId ? { ...t, customTitle } : t));
      report({
        type: 'TERMINAL_TAB_INFO_CHANGED',
        terminalId,
        changes: { customTitle },
      });
      return { data: { terminals } };
    },
    'terminal.CWD_CHANGED': ({ data: { terminalId, cwd, title } }, { data, report }) => {
      const terminals = data.terminals.map((t) => {
        if (t.id !== terminalId) return t;
        const updated = { ...t, cwd };
        if (title) updated.title = title;
        return updated;
      });
      const described = terminals.find((t) => t.id === terminalId);
      if (described) terminalPool.describe(described);
      report({
        type: 'TERMINAL_TAB_INFO_CHANGED',
        terminalId,
        changes: { cwd, title },
      });
      return { data: { terminals } };
    },
    'terminal.CLIPBOARD': ({ data: { text } }) => {
      void window.electronAPI?.clipboard.writeText(text).catch(() => false);
    },
    'terminal.BELL': ({ data: { terminalId, bellId } }, { data }) => {
      const before = data.activity[terminalId] ?? {};
      const activity = { ...data.activity, [terminalId]: { ...before, bell: true } };

      let bells: Record<string, 'flashing' | 'quiet'> | undefined;
      if (data.bells[terminalId] === undefined) {
        const flash = data.settings?.bellFlash !== false;
        bells = { ...data.bells, [terminalId]: flash ? 'flashing' : 'quiet' };
      }

      let notifying: Record<string, true> | undefined;
      if (
        data.notifying[terminalId] === undefined &&
        data.settings?.bellNotification === true &&
        !document.hasFocus()
      ) {
        notifying = { ...data.notifying, [terminalId]: true };
        showBellNotification(bellId);
      }

      return {
        data: {
          activity,
          ...(bells ? { bells } : {}),
          ...(notifying ? { notifying } : {}),
        },
      };
    },
    'terminal.BELL_FLASH_ENDED': ({ terminalId }, { data }) => {
      if (data.bells[terminalId] !== 'flashing') return;
      return { data: { bells: { ...data.bells, [terminalId]: 'quiet' } } };
    },
    'terminal.BELL_WINDOW_ENDED': ({ terminalId }, { data }) => {
      if (!(terminalId in data.bells)) return;
      const { [terminalId]: _closed, ...bells } = data.bells;
      return { data: { bells } };
    },
    'terminal.BELL_NOTIFY_WINDOW_ENDED': ({ terminalId }, { data }) => {
      if (!(terminalId in data.notifying)) return;
      const { [terminalId]: _closed, ...notifying } = data.notifying;
      return { data: { notifying } };
    },
    'terminal.NOTIFIED': ({ data: { terminalId, title, body } }, { data }) => {
      const before = data.activity[terminalId] ?? {};
      const activity = { ...data.activity, [terminalId]: { ...before, notification: { title, body } } };
      if (!document.hasFocus() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title || 'Terminal', { body, tag: `terminal:${terminalId}` });
      }
      return { data: { activity } };
    },
    'terminal.PROGRESS': ({ data: { terminalId, state: progressState, percent } }, { data }) => {
      const before = data.activity[terminalId] ?? {};
      const { progress: _was, ...rest } = before;
      const after: TerminalActivity =
        progressState === 'none' ? rest : { ...rest, progress: { state: progressState, percent } };
      return { data: { activity: { ...data.activity, [terminalId]: after } } };
    },
    'terminal.TITLED': ({ data: { terminalId, title } }, { data }) => {
      const before = data.activity[terminalId] ?? {};
      const { title: _was, ...rest } = before;
      const after: TerminalActivity = title === '' ? rest : { ...rest, title };
      return { data: { activity: { ...data.activity, [terminalId]: after } } };
    },
    'terminal.STATUS': ({ data: { terminalId, statuses } }, { data }) => {
      const terminal = data.terminals.find((one) => one.id === terminalId);
      let statusNotified: Record<string, true> | undefined;

      if (terminal) {
        if (lookedAt(terminal.statuses, statuses)) {
          if (terminalId in data.statusNotified) {
            const { [terminalId]: _looked, ...rest } = data.statusNotified;
            statusNotified = rest;
          }
        } else {
          const wanting = newlyWanting(terminal.statuses, statuses);
          if (
            wanting &&
            data.statusNotified[terminalId] === undefined &&
            !document.hasFocus() &&
            data.settings?.terminalStatusNotification !== false
          ) {
            statusNotified = { ...data.statusNotified, [terminalId]: true };
            showStatusNotification(
              terminalId,
              terminal.customTitle || terminalNameFor(terminal.cwd) || terminal.title,
              wanting,
            );
          }
        }
      }

      const terminals = data.terminals.map((t) => {
        if (t.id !== terminalId) return t;
        const { statuses: _were, ...rest } = t;
        return statuses.length ? { ...rest, statuses } : rest;
      });

      return {
        data: {
          terminals,
          ...(statusNotified !== undefined ? { statusNotified } : {}),
        },
      };
    },
    'terminal.SEEN': ({ terminalId }, { data, tell }) => {
      let activity: Record<string, TerminalActivity> | undefined;
      const before = data.activity[terminalId];
      if (before?.bell || before?.notification) {
        const { bell: _bell, notification: _notification, ...rest } = before;
        activity = { ...data.activity, [terminalId]: rest };
      }

      let statusNotified: Record<string, true> | undefined;
      if (data.statusNotified[terminalId] !== undefined) {
        const { [terminalId]: _looked, ...rest } = data.statusNotified;
        statusNotified = rest;
      }

      if (needsLooking(data.terminals.find((t) => t.id === terminalId)?.statuses)) {
        tell('code', { type: 'terminal.STATUS_SEEN', terminalId });
      }

      if (!activity && !statusNotified) return;
      return {
        data: {
          ...(activity ? { activity } : {}),
          ...(statusNotified ? { statusNotified } : {}),
        },
      };
    },
    'terminal.FAILURES_TOLD': ({ told }, { data }) => ({
      data: { failures: data.failures.filter((failure) => !told.includes(failure)) },
    }),
    'terminal.KEEP': ({ terminalId, kept }, { call }) => {
      call('keep', { terminalId, kept });
    },
    'terminal.KEPT': ({ data: { terminalId, kept } }, { data }) => {
      const terminals = data.terminals.map((t) => (t.id === terminalId ? { ...t, kept } : t));
      const described = terminals.find((t) => t.id === terminalId);
      if (described) terminalPool.describe(described);
      return { data: { terminals } };
    },
    'terminal.REWIND': ({ terminalId, cols, rows }, { call }) => {
      call('rewind', { terminalId, cols, rows });
    },
    'terminal.REWIND_SEEK': ({ at }, { data, call }) => {
      if (data.rewind) call('seek', { session: data.rewind.session, at });
    },
    'terminal.REWIND_CLOSE': (_event, { data, tell }) => {
      if (data.rewind) {
        tell('code', { type: 'terminal.REWIND_CLOSE', session: data.rewind.session });
        terminalPool.dispose(rewindViewId(data.rewind.session));
      }
      return { data: { rewind: null } };
    },
    'terminal.REWIND_RESIZE': ({ cols, rows }, { data, tell }) => {
      if (data.rewind) {
        tell('code', { type: 'terminal.REWIND_RESIZE', session: data.rewind.session, cols, rows });
      }
    },
    'terminal.RESIZED': ({ data: grid }, { data }) => ({
      data: { terminals: applyTerminalGrid(data.terminals, grid) },
    }),
  },
});
