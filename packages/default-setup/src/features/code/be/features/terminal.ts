import { answer } from '../answer.ts'
import { featureSettings } from '#generated/settings.ts';
import type { OutgoingTerminalEvents } from '../contract.ts'

import { broadcastToSurface, sendToSystem } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup, assign, fromPromise } from 'xstate'

import { terminalService } from '../services/terminal.ts'
import type { TerminalInfo } from '../types.ts'
import { cwdAsReported } from '../utils/osc-cwd.ts'
import type { TerminalEvent } from '@apackdev/sdk/services'
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { onConnectionEnded } from '@apackdev/sdk/events';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingCodeEvents } from '../contract.ts'

const logger = createLogger('terminal');

const surfaceId = 'code' as const

// Incoming events from frontend

// Outgoing events to frontend

export interface CodeTerminalSystemContext {
  baseDirectory: string | null
}

export type Event =
  | { type: 'terminal.CREATE_TERMINAL';
      title?: string;
      cwd?: string;
      shell?: string;
      cols?: number;
      rows?: number;
      target?: string;
    }
  | { type: 'terminal.CLOSE_TERMINAL'; terminalId: string }
  | { type: 'terminal.RESTART_TERMINAL'; terminalId: string }
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE_TERMINAL'; terminalId: string; cols: number; rows: number; cellWidth?: number; cellHeight?: number }
  | { type: 'terminal.STOPPED_FITTING'; terminalId: string }
  | { type: 'terminal.RENAME_TERMINAL'; terminalId: string; customTitle: string }
  | { type: 'terminal.OPENED'; data: TerminalInfo }
  | { type: 'terminal.REFRESH_LIST' }
  | { type: 'terminal.OPEN_TERMINAL_TAB'; terminalId: string }
  | { type: 'terminal.KEEP_TERMINAL'; terminalId: string; kept: boolean }
  | { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.REWIND_SEEK'; session: string; at: number }
  | { type: 'terminal.REWIND_CLOSE'; session: string }
  /** The window looking back through a recording measured how many cells fit where it draws it */
  | { type: 'terminal.REWIND_RESIZE'; session: string; cols: number; rows: number }
  | { type: 'terminal.UPDATE_BASE_DIRECTORY'; path: string }
  | { type: 'GET_CODE_START' };

/** A terminal's news, for every window showing the code surface: what its process did, never a listing */
type TerminalNewsType = 'terminal.CWD_CHANGED' | 'terminal.CLIPBOARD' | 'terminal.BELL' | 'terminal.NOTIFIED'
  | 'terminal.PROGRESS' | 'terminal.TITLED' | 'terminal.CLOSED' | 'terminal.CREATED'
  | 'terminal.CRASHED' | 'terminal.RESTARTED' | 'terminal.RESIZED' | 'terminal.KEPT'
type TerminalNews = Extract<OutgoingTerminalEvents, { type: TerminalNewsType }>

/** Tell every window showing the code surface what a terminal did */
const emitToFrontend = (event: TerminalNews) => {
  broadcastToSurface(surfaceId, event)
}

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
    void terminalService.forgetClient(client)
      .then(moved => {
        for (const { terminalId, grid } of moved) {
          emitToFrontend({ type: 'terminal.RESIZED', data: { terminalId, cols: grid.cols, rows: grid.rows } })
        }
      })
      .catch(error => { logger.error(`Could not release the fits of connection ${client}`, { error }) })
  })
}

/**
 * Where a terminal's news and its exit go — **given to the service before the session exists**, not
 * registered after it returns, so nothing a shell does first has nowhere to go.
 */
const terminalHandlers = {
  onEvent(terminalId: string, event: TerminalEvent) {
    switch (event.kind) {
      // A command that finished may have changed the repository or an open file with no file event for it
      case 'commandFinished':
        sendToSystem('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' })
        break
      case 'cwdChanged': {
        // Shaped for this platform: an OSC 7 URL gives `/C:/Users/...` on Windows, which nothing can open
        const cwd = cwdAsReported(event.cwd)
        const moved = cwd === undefined ? undefined : terminalService.updateCwd(terminalId, cwd)
        if (moved) emitToFrontend({ type: 'terminal.CWD_CHANGED', data: { terminalId, cwd: moved.cwd, title: moved.title } })
        break
      }
      // **A claim, handed to the windows to act on.** The program asked; a window that has the person's
      // attention is where putting text on their clipboard, or telling them something, happens
      case 'clipboard':
        // The person's to allow: what is on a clipboard is what the next paste runs
        if (featureSettings.forFeature('code').get()?.terminalClipboardWrite === false) break
        emitToFrontend({ type: 'terminal.CLIPBOARD', data: { terminalId, text: event.text } })
        break
      case 'bell':
        emitToFrontend({ type: 'terminal.BELL', data: { terminalId } })
        break
      case 'notification':
        emitToFrontend({ type: 'terminal.NOTIFIED', data: { terminalId, title: event.title, body: event.body } })
        break
      case 'progress':
        emitToFrontend({ type: 'terminal.PROGRESS', data: { terminalId, state: event.state, percent: event.percent } })
        break
      case 'title':
        emitToFrontend({ type: 'terminal.TITLED', data: { terminalId, title: event.title } })
        break
      // The shell saying a command began is the start of nothing this feature tracks
      case 'commandStarted':
        break
    }
  },

  onExit(terminalId: string) {
    try {
      emitToFrontend({ type: 'terminal.CLOSED', data: { terminalId } })
    } catch (error) {
      logger.error(`Error emitting CLOSED for ${terminalId}`, { error })
    }
  },

  // **News, not an answer**: a shell dying is something that happened, which every window showing this
  // terminal has to hear. Nobody asked, so there is nothing to correlate it against
  onCrashed(terminalId: string, code: number | null) {
    try {
      emitToFrontend({ type: 'terminal.CRASHED', data: { terminalId, code } })
    } catch (error) {
      logger.error(`Error emitting CRASHED for ${terminalId}`, { error })
    }
  },
}

/**
 * A terminal failure: reported to the user, and answered to whoever asked.
 *
 * `terminal.ERROR` settles the ask it answers — the surface keeps one entry per outstanding open — so it
 * still travels. What it never did was reach the user: the surface wrote the message to a context field that
 * nothing rendered, so every terminal failure was silent. `reportError` is the mechanism that reaches them,
 * the app turning a system error into a toast, and it needs no new published API — `HostShell` exposes no
 * `notify`, and adding one for this would publish a second way to say the same thing.
 *
 * A failure nobody asked for is reported and not broadcast. An error is not news: every window would raise
 * it, including the ones whose user did nothing.
 */
const failTerminal = (
  reply: Reply<OutgoingCodeEvents> | undefined,
  operation: string,
  error: unknown,
  terminalId?: string,
) => {
  const message = error instanceof Error ? error.message : String(error)
  reportError({ error, title: 'Terminal error', source: 'terminal', operation })
  answer(reply, { type: 'terminal.ERROR', data: { message, ...(terminalId ? { terminalId } : {}) } })
}

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeTerminalSystemContext, Event>();

export const terminalSystem = setup({
  types: {
    context: {} as CodeTerminalSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null }
  },
  actors: {
    restoreTerminalsActor: fromPromise(async () => {
      const codeSettings = featureSettings.forFeature('code').get()
      if (codeSettings?.restoreTerminals === false) {
        logger.info('Terminal restoration disabled by settings')
      } else {
        await terminalService.restoreAll(terminalHandlers)
        logger.info('Terminal restoration complete')
      }
      // Whatever was left running and is under no terminal now: every one of them, where nothing is restored
      await terminalService.endUnclaimedKept()
    })
  },
  actions: handlers.actions({
    /** The running terminals, answered to the window that asked as it starts */
    sendConnectedData: ({ reply }) => {
      answer(reply, { type: 'terminal.TERMINALS_LISTED', data: terminalService.list() })
    },

    createTerminal: ({ event, context, reply }) => {
      const ev = event as {
        type: 'terminal.CREATE_TERMINAL';
        title?: string;
        cwd?: string;
        shell?: string;
        cols?: number;
        rows?: number;
        target?: string;
      }
      const cwd = ev.cwd || context.baseDirectory
      // **The answer waits for the session**, because the process is the broker's and a socket away. `reply`
      // is bound to the delivery this handler was entered in, so it still answers the window that asked
      // after an await — an answer a handler holds keeps working wherever it is called.
      void terminalService.create({
        title: ev.title,
        cwd: cwd && cwd.trim() ? cwd : undefined,
        shell: ev.shell,
        cols: ev.cols || 80,
        rows: ev.rows || 24,
        target: ev.target,
      }, terminalHandlers).then(terminalInfo => {
        // The two halves of what used to be one event: every window's list grows, and only the window that
        // asked opens it. A terminal's id is minted here, so nothing the asker sent could have identified it
        emitToFrontend({ type: 'terminal.CREATED', data: { terminalId: terminalInfo.id } })
        reply?.({ type: 'terminal.OPENED', data: terminalInfo })
      }).catch(error => failTerminal(reply, 'create', error))
    },

    restartTerminal: ({ event, reply }) => {
      const ev = event as { type: 'terminal.RESTART_TERMINAL'; terminalId: string }
      void terminalService.restart(ev.terminalId, terminalHandlers).then(info => {
        if (!info) {
          failTerminal(reply, 'restart', new Error(`No terminal ${ev.terminalId}`))
          return
        }
        // Every window showing this terminal has a new shell under it; the one that asked hears it too,
        // which is why this is news rather than a reply — a restart is not private to the window that
        // clicked it
        emitToFrontend({ type: 'terminal.RESTARTED', data: info })
      }).catch(error => failTerminal(reply, 'restart', error))
    },

    closeTerminal: ({ event, reply }) => {
      const ev = event as { type: 'terminal.CLOSE_TERMINAL'; terminalId: string }
      try {
        const terminal = terminalService.get(ev.terminalId)
        const terminalName = terminal ? terminal.info.title : 'Terminal'
        // **Awaited, not checked for truth.** The service answers a promise now, and `if (!promise)` is
        // never true — the refusal below was dead the moment the broker owned the process.
        void terminalService.kill(ev.terminalId, terminalHandlers)
          .then(outcome => {
            // Only one of these is a terminal that was not there. A broker that would not end the session
            // closed the terminal all the same, so the user is told what happened rather than that they
            // asked about something that does not exist
            if (outcome === 'unknown') failTerminal(reply, 'close', `${terminalName} not found`, ev.terminalId)
            else if (outcome === 'refused') {
              failTerminal(reply, 'close', `The broker would not end ${terminalName}; it is closed here`, ev.terminalId)
            }
          })
          .catch(error => failTerminal(reply, 'close', error, ev.terminalId))
      } catch (error) {
        failTerminal(reply, 'close', error, ev.terminalId)
      }
    },

    sendTerminalInput: ({ event, reply }) => {
      const ev = event as { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
      try {
        const terminal = terminalService.get(ev.terminalId)
        const terminalName = terminal ? terminal.info.title : 'Terminal'
        // **Awaited, not checked for truth.** The service answers a promise now, and `if (!promise)` is
        // never true — the refusal below was dead the moment the broker owned the process.
        void terminalService.write(ev.terminalId, ev.data)
          .then(found => {
            if (!found) failTerminal(reply, 'input', `${terminalName} not found`, ev.terminalId)
          })
          .catch(error => failTerminal(reply, 'input', error, ev.terminalId))
      } catch (error) {
        failTerminal(reply, 'input', error, ev.terminalId)
      }
    },

    resizeTerminal: ({ event, reply, client }) => {
      const ev = event as {
        type: 'terminal.RESIZE_TERMINAL'; terminalId: string; cols: number; rows: number
        cellWidth?: number; cellHeight?: number
      }
      // One cell in pixels, where the window measured one: what a program asking for the size in pixels is told
      const cell = ev.cellWidth && ev.cellHeight ? { width: ev.cellWidth, height: ev.cellHeight } : undefined
      try {
        const terminal = terminalService.get(ev.terminalId)
        const terminalName = terminal ? terminal.info.title : 'Terminal'
        // **Every window's fit is recorded, and the pty runs at the smallest** (`TerminalService.resize`):
        // a pty has one `(cols, rows)`, and the smallest fit is the one every window showing it can draw
        // whole. `client` names the connection the message arrived on, which the API stamps and nobody
        // can forge.
        void terminalService.resize(ev.terminalId, ev.cols, ev.rows, client, cell)
          .then(accepted => {
            if (!accepted) {
              failTerminal(reply, 'resize', `${terminalName} not found`, ev.terminalId)
              return
            }
            const grid = { terminalId: ev.terminalId, cols: accepted.cols, rows: accepted.rows }
            // **The grid moved, so every window showing this terminal needs it** — each renders the accepted
            // one rather than whatever it fitted for itself, which is what stops a second window drawing at
            // a size nothing agreed to.
            if (accepted.changed) {
              emitToFrontend({ type: 'terminal.RESIZED', data: grid })
              return
            }
            // **Nothing moved, so this is not news** — but if the asker did not get what it asked for, that
            // is the asker's business and nobody else's, so it is replied rather than broadcast.
            if (accepted.cols !== ev.cols || accepted.rows !== ev.rows) {
              reply?.({ type: 'terminal.RESIZED', data: grid })
            }
          })
          .catch(error => failTerminal(reply, 'resize', error, ev.terminalId))
      } catch (error) {
        failTerminal(reply, 'resize', error, ev.terminalId)
      }
    },

    /**
     * A window has stopped showing a terminal, so the grid may rise for the windows that still are.
     *
     * Broadcast and never replied: the asker is the window that just stopped drawing it, and the windows
     * that need the new grid are the others.
     */
    stoppedFitting: ({ event, client }) => {
      const ev = event as { type: 'terminal.STOPPED_FITTING'; terminalId: string }
      if (client === undefined) return
      void terminalService.stoppedFitting(ev.terminalId, client)
        .then(accepted => {
          if (!accepted?.changed) return
          emitToFrontend({ type: 'terminal.RESIZED', data: { terminalId: ev.terminalId, cols: accepted.cols, rows: accepted.rows } })
        })
        .catch(error => { logger.error(`Could not release ${ev.terminalId}'s fit`, { error }) })
    },

    renameTerminal: ({ event, reply }) => {
      const ev = event as { type: 'terminal.RENAME_TERMINAL'; terminalId: string; customTitle: string }
      try {
        const terminal = terminalService.get(ev.terminalId)
        const terminalName = terminal ? terminal.info.title : 'Terminal'
        const success = terminalService.rename(ev.terminalId, ev.customTitle)
        if (!success) {
          failTerminal(reply, 'rename', `${terminalName} not found`, ev.terminalId)
        } else {
          // Emit success event
          broadcastToSurface(surfaceId, {
            type: 'terminal.RENAMED',
            data: { terminalId: ev.terminalId, customTitle: ev.customTitle }
          })
        }
      } catch (error) {
        failTerminal(reply, 'rename', error, ev.terminalId)
      }
    },

    listTerminals: ({ reply }) => {
      try {
        const terminals = terminalService.list()
        answer(reply, {
          type: 'terminal.TERMINALS_LISTED',
          data: terminals
        })
      } catch (error) {
        failTerminal(reply, 'list', error)
      }
    },

    openTerminalTab: ({ event, reply }) => {
      const ev = event as { type: 'terminal.OPEN_TERMINAL_TAB'; terminalId: string }
      try {
        const terminals = terminalService.list()
        const terminal = terminals.find(t => t.id === ev.terminalId)

        if (terminal) {
          answer(reply, {
            type: 'terminal.TERMINAL_TAB_OPENED',
            data: terminal
          })
        } else {
          failTerminal(reply, 'open-tab', 'Terminal not found', ev.terminalId)
        }
      } catch (error) {
        failTerminal(reply, 'open-tab', error, ev.terminalId)
      }
    },

    /** News rather than a reply: every window showing the terminal marks it as one that keeps running */
    keepTerminal: ({ event, reply }) => {
      const ev = event as { type: 'terminal.KEEP_TERMINAL'; terminalId: string; kept: boolean }
      void terminalService.keep(ev.terminalId, ev.kept).then(info => {
        if (!info) {
          failTerminal(reply, 'keep', new Error(`No running terminal ${ev.terminalId}`), ev.terminalId)
          return
        }
        emitToFrontend({ type: 'terminal.KEPT', data: { terminalId: ev.terminalId, kept: ev.kept } })
      }).catch(error => failTerminal(reply, 'keep', error, ev.terminalId))
    },

    /** Replied: a recording is opened for the window that asked to look, and nobody else is looking */
    rewindTerminal: ({ event, reply, client }) => {
      const ev = event as { type: 'terminal.REWIND'; terminalId: string; cols: number; rows: number }
      void terminalService.rewind(ev.terminalId, { cols: ev.cols, rows: ev.rows }, client).then(opened => {
        if (!opened) {
          failTerminal(reply, 'rewind', new Error(`No terminal ${ev.terminalId}`), ev.terminalId)
          return
        }
        answer(reply, { type: 'terminal.REWOUND', data: opened })
      }).catch(error => failTerminal(reply, 'rewind', error, ev.terminalId))
    },

    seekRewind: ({ event, reply }) => {
      const ev = event as { type: 'terminal.REWIND_SEEK'; session: string; at: number }
      void terminalService.seekRewind(ev.session, ev.at).then(at => {
        if (at !== null) answer(reply, { type: 'terminal.REWIND_SOUGHT', data: { session: ev.session, at } })
      }).catch(error => failTerminal(reply, 'rewind', error))
    },

    resizeRewind: ({ event }) => {
      const ev = event as { type: 'terminal.REWIND_RESIZE'; session: string; cols: number; rows: number }
      void terminalService.resizeRewind(ev.session, ev.cols, ev.rows).catch(error => { logger.error('Could not resize a recording', { error }) })
    },

    closeRewind: ({ event }) => {
      const ev = event as { type: 'terminal.REWIND_CLOSE'; session: string }
      void terminalService.closeRewind(ev.session).catch(error => { logger.error('Could not close a recording', { error }) })
    },

    updateBaseDirectory: assign({
      baseDirectory: ({ event }) => {
        const ev = event as { type: 'terminal.UPDATE_BASE_DIRECTORY'; path: string }
        return ev.path
      }
    })
  })
}).createMachine({
  id: 'terminal',
  initial: 'initializing',
  context: ({ input }: { input?: { baseDirectory: string | null } }) => ({
    baseDirectory: input?.baseDirectory || null
  }),
  // Stateless handlers safe during initialization
  on: {
    'terminal.TERMINAL_INPUT': {
      actions: 'sendTerminalInput'
    },
    'terminal.RESIZE_TERMINAL': {
      actions: 'resizeTerminal'
    },
    'terminal.STOPPED_FITTING': {
      actions: 'stoppedFitting'
    },
    'terminal.RENAME_TERMINAL': {
      actions: 'renameTerminal'
    },
    'terminal.UPDATE_BASE_DIRECTORY': {
      actions: 'updateBaseDirectory'
    }
  },
  states: {
    initializing: {
      invoke: {
        src: 'restoreTerminalsActor',
        onDone: {
          target: 'idle',
          actions: 'sendConnectedData'
        },
        // **A rejection here used to stop the terminal system for the session** (L1), in silence: with no
        // `onError` the machine stays in `initializing`, where it handles nothing, so every later
        // `terminal.CREATE_TERMINAL` and every `GET_CODE_START` went nowhere and the surface showed an
        // empty list for ever. Restoring is best-effort — what it restores is a convenience, and the
        // previous run's processes are gone either way — so a failure is reported and the system goes on.
        //
        // **Nothing fires this branch today, and all three ways in are closed** — checked 2026-11-08, so
        // the next reader need not re-derive it. Everything `restoreAll` does per terminal is inside a
        // `try`, so an open that fails is already survived (`terminal-survives-a-failed-restore.spec.ts` is
        // that case) and cannot reach here. What sits outside that `try`:
        //
        // - **a bad row cannot do it.** `directoryFor`/`shellFor` would throw on a non-string, and a row is
        //   data (S3) — but the engine refuses one: a `Terminal` whose `cwd` is a number is rejected with
        //   *Terminal.cwd is a string: it got a number*, for every writer, `apack db exec` included.
        // - **the settings read cannot be made to throw from a test.** The unit harness binds the app's own
        //   settings store rather than an overridable mock, deliberately, so `mockService('settings', …)`
        //   does not reach `handle.get()`.
        // - **the query would need the engine itself to fail.**
        //
        // So this is an assertion rather than a gate, and the edit that would change that is still in
        // `restoreAll`: move the settings read or the query inside the loop's `try`, or add an `await` after
        // either, and the actor can reject again.
        onError: {
          target: 'idle',
          actions: [
            ({ event }) => {
              reportError({
                error: (event as { error?: unknown }).error,
                title: 'Could not restore terminals',
                source: 'terminal',
                operation: 'restore',
              })
            },
            'sendConnectedData',
          ],
        }
      }
    },
    idle: {
      on: {
        'GET_CODE_START': {
          actions: 'sendConnectedData'
        },
        'terminal.CREATE_TERMINAL': {
          actions: 'createTerminal'
        },
        'terminal.CLOSE_TERMINAL': {
          actions: 'closeTerminal'
        },
        'terminal.RESTART_TERMINAL': {
          actions: 'restartTerminal'
        },
        'terminal.REFRESH_LIST': {
          actions: 'listTerminals'
        },
        'terminal.OPEN_TERMINAL_TAB': {
          actions: 'openTerminalTab'
        },
        'terminal.KEEP_TERMINAL': {
          actions: 'keepTerminal'
        },
        'terminal.REWIND': {
          actions: 'rewindTerminal'
        },
        'terminal.REWIND_SEEK': {
          actions: 'seekRewind'
        },
        'terminal.REWIND_CLOSE': {
          actions: 'closeRewind'
        },
        'terminal.REWIND_RESIZE': {
          actions: 'resizeRewind'
        }
      }
    }
  }
})