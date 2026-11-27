import { given } from '@apackdev/state';
import { featureSettings } from '#generated/settings.ts';
import type { OutgoingTerminalEvents, TerminalAsks } from '../contract.ts';
import { broadcast as busBroadcast, tell } from '#generated/events.ts';
import { state } from '#generated/state.ts';
import { terminalService } from '../services/terminal.ts';
import { cwdAsReported } from '../utils/osc-cwd.ts';
import { statusMoves } from '../utils/terminal-status.ts';
import type { TerminalEvent } from '@apackdev/sdk/services';
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { currentClient, onConnectionEnded, type NormalizeAsks } from '@apackdev/sdk/events';

const logger = createLogger('terminal');

const surfaceId = 'code' as const;

/** Gate held open once initial terminal restoration finishes (or when the terminal system exits). */
class RestoreGate {
  private resolve!: () => void;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }

  open(): void {
    this.resolve();
  }
}

/** Waits for terminal restoration, aborting immediately if the ask or system was cancelled. */
async function awaitRestore(restore: { readonly ready: PromiseLike<void> } | null, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Cancelled');
  if (restore) {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
      void restore.ready.then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }
  if (signal.aborted) throw new Error('Cancelled');
}

export interface CodeTerminalSystemContext {
  baseDirectory: string | null;
  restore: RestoreGate | null;
}

/** What the terminal child handles: a window's input that nobody answers, and the code system's own */
export type Event =
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  | { type: 'terminal.STOPPED_FITTING'; terminalId: string }
  | { type: 'terminal.STATUS_SEEN'; terminalId: string }
  | { type: 'terminal.REWIND_CLOSE'; session: string }
  /** The window looking back through a recording measured how many cells fit where it draws it */
  | { type: 'terminal.REWIND_RESIZE'; session: string; cols: number; rows: number }
  | { type: 'terminal.UPDATE_BASE_DIRECTORY'; path: string };

/** A terminal's news, for every window showing the code surface: what its process did, never a listing */
type TerminalNewsType =
  | 'terminal.CWD_CHANGED'
  | 'terminal.CLIPBOARD'
  | 'terminal.BELL'
  | 'terminal.NOTIFIED'
  | 'terminal.PROGRESS'
  | 'terminal.TITLED'
  | 'terminal.CLOSED'
  | 'terminal.CREATED'
  | 'terminal.CRASHED'
  | 'terminal.RESTARTED'
  | 'terminal.RESIZED'
  | 'terminal.KEPT'
  | 'terminal.STATUS';
type TerminalNews = Extract<OutgoingTerminalEvents, { type: TerminalNewsType }>;

/** Tell every window showing the code surface what a terminal did */
const emitToFrontend = (event: TerminalNews) => {
  busBroadcast(surfaceId, event);
};

/**
 * Follows connections ending, so a terminal stops being held to the fit of a window that has gone.
 *
 * **A fit outlives its window otherwise, and nothing else can tell.** The connection id a window fits on is
 * minted per socket, so one that reloads, sleeps or drops comes back as a different window and can never
 * clear what the old one left; the grid would stay held down by a window nobody can see. This is the only
 * notice that it went.
 *
 * Taken from `boot.onInit` rather than at module scope — it reads the bound app, and a unit test importing
 * this module binds none — and disposed from `boot.onShutdown`.
 */
export function startTerminalSizing(): () => void {
  return onConnectionEnded((client) => {
    void terminalService
      .forgetClient(client)
      .then((moved) => {
        for (const { terminalId, grid } of moved) {
          emitToFrontend({ type: 'terminal.RESIZED', data: { terminalId, cols: grid.cols, rows: grid.rows } });
        }
      })
      .catch((error) => {
        logger.error(`Could not release the fits of connection ${client}`, { error });
      });
  });
}

/**
 * The bells this backend process has emitted. The id is unique within a run, which is all a bell's identity needs:
 * the main process forgets a shown id within a minute, and no terminal keeps its id across a restart.
 */
let bellCount = 0;

/**
 * Where a terminal's news and its exit go — **given to the service before the session exists**, not
 * registered after it returns, so nothing a shell does first has nowhere to go.
 */
const terminalHandlers = {
  onEvent(terminalId: string, event: TerminalEvent) {
    switch (event.kind) {
      // A command that finished may have changed the repository or an open file with no file event for it
      case 'commandFinished':
        tell('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' });
        break;
      case 'cwdChanged': {
        // Shaped for this platform: an OSC 7 URL gives `/C:/Users/...` on Windows, which nothing can open
        const cwd = cwdAsReported(event.cwd);
        const moved = cwd === undefined ? undefined : terminalService.updateCwd(terminalId, cwd);
        if (moved) emitToFrontend({ type: 'terminal.CWD_CHANGED', data: { terminalId, cwd: moved.cwd, title: moved.title } });
        break;
      }
      // **A claim, handed to the windows to act on.** The program asked; a window that has the person's
      // attention is where putting text on their clipboard, or telling them something, happens
      case 'clipboard':
        // The person's to allow: what is on a clipboard is what the next paste runs
        if (featureSettings.forFeature('code').get()?.terminalClipboardWrite === false) break;
        emitToFrontend({ type: 'terminal.CLIPBOARD', data: { terminalId, text: event.text } });
        break;
      case 'bell':
        emitToFrontend({ type: 'terminal.BELL', data: { terminalId, bellId: `${terminalId}#${++bellCount}` } });
        break;
      case 'notification':
        emitToFrontend({ type: 'terminal.NOTIFIED', data: { terminalId, title: event.title, body: event.body } });
        break;
      case 'progress':
        emitToFrontend({ type: 'terminal.PROGRESS', data: { terminalId, state: event.state, percent: event.percent } });
        break;
      case 'title':
        emitToFrontend({ type: 'terminal.TITLED', data: { terminalId, title: event.title } });
        break;
      // **What the terminal's programs say they are doing** (OSC 7501): shown, and never acted on for them.
      // Two things follow from a change, neither of which answers the program. A record leaving `working`
      // is an agent's turn ending as far as anything says, and it may have changed the repository with no
      // file event for it — the same hint a finished command gives. And a flow may be waiting to hear
      case 'programStatus': {
        const heard = terminalService.heardStatuses(terminalId, event.statuses);
        if (!heard) break;
        emitToFrontend({ type: 'terminal.STATUS', data: { terminalId, statuses: heard.after } });
        const { moves, leftWorking } = statusMoves(heard.before, heard.after);
        if (leftWorking) tell('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' });
        for (const { record, previous } of moves) {
          // A record naming a program that is not the one in front is drawn as such and tells no flow:
          // a flow acts on what it hears
          if (record.confirmed === 'mismatched') continue;
          tell(
            { role: 'brain' },
            {
              type: 'TRIGGER_BRAIN_EVENT',
              eventType: 'terminal.status',
              payload: { terminalId, id: record.id, app: record.app, state: record.state, kind: record.kind, previous },
            },
          );
        }
        break;
      }
      // The shell saying a command began is the start of nothing this feature tracks
      case 'commandStarted':
        break;
    }
  },

  onExit(terminalId: string) {
    try {
      emitToFrontend({ type: 'terminal.CLOSED', data: { terminalId } });
    } catch (error) {
      logger.error(`Error emitting CLOSED for ${terminalId}`, { error });
    }
  },

  // **News, not an answer**: a shell dying is something that happened, which every window showing this
  // terminal has to hear. Nobody asked, so there is nothing to correlate it against
  onCrashed(terminalId: string, code: number | null) {
    try {
      emitToFrontend({ type: 'terminal.CRASHED', data: { terminalId, code } });
    } catch (error) {
      logger.error(`Error emitting CRASHED for ${terminalId}`, { error });
    }
  },
};

/**
 * A failure of something nobody asked for, reported to the user: keystrokes for a terminal that is not there.
 * `reportError` is what reaches them, the app turning a system error into a toast. An ask's failure is not
 * reported here: it is its asker's, which the ask's answer tells
 */
const failTerminal = (operation: string, error: unknown): void => {
  reportError({ error, title: 'Terminal error', source: 'terminal', operation });
};

/** A terminal's title, for saying which one was not found */
const nameOf = (terminalId: string) => terminalService.get(terminalId)?.info.title ?? 'Terminal';

type TerminalShape = {
  data: CodeTerminalSystemContext;
  states: {
    initializing: {};
    idle: {};
  };
};

export const terminalSystem = state<TerminalShape, Event, NormalizeAsks<TerminalAsks>>()({
  data: {
    baseDirectory: given,
    restore: null,
  },
  initial: 'initializing',
  run: () => ({ data: { restore: new RestoreGate() } }),
  // Stateless handlers safe during initialization. The asks are taken in every state: those about the terminals
  // the restore takes up wait for `data.restore.ready`, so they are answered from the list as restored
  on: {
    /** Keystrokes: a terminal that is not there is reported, and nothing is answered */
    'terminal.TERMINAL_INPUT': ({ terminalId, data }) => {
      const terminalName = nameOf(terminalId);
      void terminalService
        .write(terminalId, data)
        .then((found) => {
          if (!found) failTerminal('input', new Error(`${terminalName} not found`));
        })
        .catch((error) => failTerminal('input', error));
    },

    /**
     * A window has stopped showing a terminal, so the grid may rise for the windows that still are.
     *
     * Broadcast and never answered: the sender is the window that just stopped drawing it, and the windows
     * that need the new grid are the others.
     */
    'terminal.STOPPED_FITTING': ({ terminalId }, { broadcast }) => {
      const client = currentClient();
      if (client === undefined) return;
      void terminalService
        .stoppedFitting(terminalId, client)
        .then((accepted) => {
          if (!accepted?.changed) return;
          broadcast('code', { type: 'terminal.RESIZED', data: { terminalId, cols: accepted.cols, rows: accepted.rows } });
        })
        .catch((error) => {
          logger.error(`Could not release ${terminalId}'s fit`, { error });
        });
    },

    'terminal.UPDATE_BASE_DIRECTORY': ({ path }) => ({
      data: { baseDirectory: path },
    }),
  },
  answers: {
    // **The answer waits for the session**, because the process is the broker's and a socket away
    'terminal.CREATE_TERMINAL': async (args, { data, broadcast, signal }) => {
      await awaitRestore(data.restore, signal);
      const cwd = args.cwd || data.baseDirectory;
      const terminalInfo = await terminalService.create(
        {
          title: args.title,
          cwd: cwd && cwd.trim() ? cwd : undefined,
          shell: args.shell,
          cols: args.cols || 80,
          rows: args.rows || 24,
          target: args.target,
        },
        terminalHandlers,
      );
      // Every window's list grows, and only the window that asked opens it. A terminal's id is minted here, so
      // nothing the asker sent could have identified it
      broadcast('code', { type: 'terminal.CREATED', data: { terminalId: terminalInfo.id } });
      return terminalInfo;
    },

    'terminal.RESTART_TERMINAL': async ({ terminalId }, { data, broadcast, signal }) => {
      await awaitRestore(data.restore, signal);
      const info = await terminalService.restart(terminalId, terminalHandlers);
      if (!info) throw new Error(`No terminal ${terminalId}`);
      // Every window showing this terminal has a new shell under it; the one that asked hears it too, which is why
      // this is news rather than the answer — a restart is not private to the window that clicked it
      broadcast('code', { type: 'terminal.RESTARTED', data: info });
    },

    'terminal.CLOSE_TERMINAL': async ({ terminalId }, { data, signal }) => {
      await awaitRestore(data.restore, signal);
      const terminalName = nameOf(terminalId);
      const outcome = await terminalService.kill(terminalId, terminalHandlers);
      // Only one of these is a terminal that was not there. A broker that would not end the session closed the
      // terminal all the same, so the user is told what happened rather than that they asked about something
      // that does not exist
      if (outcome === 'unknown') throw new Error(`${terminalName} not found`);
      if (outcome === 'refused') throw new Error(`The broker would not end ${terminalName}; it is closed here`);
    },

    'terminal.RESIZE_TERMINAL': async (args, { broadcast }) => {
      const client = currentClient();
      // One cell in pixels, where the window measured one: what a program asking for the size in pixels is told
      const cell = args.cellWidth && args.cellHeight ? { width: args.cellWidth, height: args.cellHeight } : undefined;
      const terminalName = nameOf(args.terminalId);
      // **Every window's fit is recorded, and the pty runs at the smallest** (`TerminalService.resize`): a pty has
      // one `(cols, rows)`, and the smallest fit is the one every window showing it can draw whole. `client` names
      // the connection the ask arrived on, which the API stamps and nobody can forge.
      const accepted = await terminalService.resize(args.terminalId, args.cols, args.rows, client, cell);
      if (!accepted) throw new Error(`${terminalName} not found`);
      const grid = { terminalId: args.terminalId, cols: accepted.cols, rows: accepted.rows };
      // **The grid moved, so every window showing this terminal needs it** — each renders the accepted one rather
      // than whatever it fitted for itself, which is what stops a second window drawing at a size nothing agreed to
      if (accepted.changed) broadcast('code', { type: 'terminal.RESIZED', data: grid });
      // The asker that did not get what it asked for is told by its answer, which is its business and nobody else's
      return accepted.cols !== args.cols || accepted.rows !== args.rows ? grid : null;
    },

    'terminal.RENAME_TERMINAL': ({ terminalId, customTitle }, { broadcast }) => {
      if (!terminalService.rename(terminalId, customTitle)) throw new Error(`${nameOf(terminalId)} not found`);
      broadcast('code', { type: 'terminal.RENAMED', data: { terminalId, customTitle } });
    },

    'terminal.REFRESH_LIST': async (_args, { data, signal }) => {
      await awaitRestore(data.restore, signal);
      return terminalService.list();
    },

    'terminal.OPEN_TERMINAL_TAB': async ({ terminalId }, { data, signal }) => {
      await awaitRestore(data.restore, signal);
      const terminal = terminalService.list().find((t) => t.id === terminalId);
      if (!terminal) throw new Error('Terminal not found');
      return terminal;
    },

    /** Every window showing the terminal marks it as one that keeps running, which is news rather than the answer */
    'terminal.KEEP_TERMINAL': async ({ terminalId, kept }, { data, broadcast, signal }) => {
      await awaitRestore(data.restore, signal);
      if (!(await terminalService.keep(terminalId, kept))) throw new Error(`No running terminal ${terminalId}`);
      broadcast('code', { type: 'terminal.KEPT', data: { terminalId, kept } });
    },

    /** A recording is opened for the window that asked to look, and nobody else is looking */
    'terminal.REWIND': async ({ terminalId, cols, rows }, { data, signal }) => {
      const client = currentClient();
      await awaitRestore(data.restore, signal);
      const opened = await terminalService.rewind(terminalId, { cols, rows }, client);
      if (!opened) throw new Error(`No terminal ${terminalId}`);
      return opened;
    },

    'terminal.REWIND_SEEK': async ({ session, at }, { data, signal }) => {
      await awaitRestore(data.restore, signal);
      const sought = await terminalService.seekRewind(session, at);
      return sought === null ? null : { session, at: sought };
    },
  },
  states: {
    initializing: {
      run: async ({ data, onExit }) => {
        onExit(() => data.restore?.open());
        const codeSettings = featureSettings.forFeature('code').get();
        if (codeSettings?.restoreTerminals === false) {
          logger.info('Terminal restoration disabled by settings');
        } else {
          await terminalService.restoreAll(terminalHandlers);
          logger.info('Terminal restoration complete');
        }
        // Whatever was left running and is under no terminal now: every one of them, where nothing is restored
        await terminalService.endUnclaimedKept();
        data.restore?.open();
        return { at: 'idle' };
      },
      // Restoring is best-effort — what it restores is a convenience, and the previous run's processes are gone
      // either way — so a failure is reported and the system moves to `idle` so waiting asks unblock.
      failed: (error, { data }) => {
        data.restore?.open();
        reportError({
          error,
          title: 'Could not restore terminals',
          source: 'terminal',
          operation: 'restore',
        });
        return { at: 'idle' };
      },
    },
    idle: {
      on: {
        /** News: what one window's person has looked at, every window stops marking */
        'terminal.STATUS_SEEN': ({ terminalId }, { broadcast }) => {
          const statuses = terminalService.statusesSeen(terminalId);
          if (statuses) broadcast('code', { type: 'terminal.STATUS', data: { terminalId, statuses } });
        },
        'terminal.REWIND_CLOSE': ({ session }) => {
          void terminalService.closeRewind(session).catch((error) => {
            logger.error('Could not close a recording', { error });
          });
        },
        'terminal.REWIND_RESIZE': ({ session, cols, rows }) => {
          void terminalService.resizeRewind(session, cols, rows).catch((error) => {
            logger.error('Could not resize a recording', { error });
          });
        },
      },
    },
  },
});
