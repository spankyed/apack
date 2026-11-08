import { answer } from '../answer.ts'
import { featureSettings } from '#generated/settings.ts';
import type { OutgoingTerminalEvents } from '../contract.ts'

import { broadcastToSurface } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup, assign, fromPromise } from 'xstate'

import { terminalService } from '../services/terminal.ts'
import { cwdFromOsc } from '../utils/osc-cwd.ts'
import type { TerminalInfo } from '../types.ts'
import { createLogger, reportError } from '@apackdev/sdk/logger';
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
    }
  | { type: 'terminal.CLOSE_TERMINAL'; terminalId: string }
  | { type: 'terminal.RESTART_TERMINAL'; terminalId: string }
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  | { type: 'terminal.RESIZE_TERMINAL'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.RENAME_TERMINAL'; terminalId: string; customTitle: string }
  | { type: 'terminal.OPENED'; data: TerminalInfo }
  | { type: 'terminal.REFRESH_LIST' }
  | { type: 'terminal.OPEN_TERMINAL_TAB'; terminalId: string }
  | { type: 'terminal.UPDATE_BASE_DIRECTORY'; path: string }
  | { type: 'GET_CODE_START' };

/** A terminal's news, for every window showing the code surface: what its process did, never a listing */
type TerminalNewsType = 'terminal.CWD_CHANGED' | 'terminal.OUTPUT' | 'terminal.CLOSED' | 'terminal.CREATED'
  | 'terminal.CRASHED' | 'terminal.RESTARTED'
type TerminalNews = Extract<OutgoingTerminalEvents, { type: TerminalNewsType }>

/** Tell every window showing the code surface what a terminal did */
const emitToFrontend = (event: TerminalNews) => {
  broadcastToSurface(surfaceId, event)
}

// Pre-compiled regex patterns for OSC sequence detection (hot path — runs on every terminal data event)
// The control characters are the sequences themselves — ESC and BEL delimit every OSC string.
/* eslint-disable no-control-regex */
const OSC_PATTERNS = [
  /\x1b\]7;file:\/\/[^/]*(\/.+?)(?:\x07|\x1b\\)/,       // OSC 7
  /\x1b\]633;P;Cwd=(.+?)(?:\x07|\x1b\\)/,                 // OSC 633
  /\x1b\]1337;CurrentDir=(.+?)(?:\x07|\x1b\\)/,            // OSC 1337
] as const
/* eslint-enable no-control-regex */

/**
 * Where a terminal's output and exit go — **given to the service before the session exists**, not registered
 * after it returns, which is F8: whatever the shell wrote first used to have nowhere to go and was dropped.
 */
const terminalHandlers = {
  onData(terminalId: string, data: string) {
    let cwdMatch: RegExpMatchArray | null = null
    for (const pattern of OSC_PATTERNS) {
      cwdMatch = data.match(pattern)
      if (cwdMatch) break
    }

    if (cwdMatch) {
      try {
        // **Decoded through one reader** (X5): an OSC 7 file URL on Windows decodes to `/C:/Users/...`,
        // which nothing there can open, and which used to be stored on the row and spawned from next launch
        const newCwd = cwdFromOsc(cwdMatch[1]!)
        if (!newCwd) return
        const result = terminalService.updateCwd(terminalId, newCwd)
        if (result) {
          emitToFrontend({ type: 'terminal.CWD_CHANGED', data: { terminalId, cwd: result.cwd, title: result.title } })
        }
      } catch (error) {
        logger.error('Failed to parse CWD from OSC sequence', { error })
      }
    }

    emitToFrontend({ type: 'terminal.OUTPUT', data: { terminalId, data } })
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
        return
      }
      await terminalService.restoreAll(terminalHandlers)
      logger.info('Terminal restoration complete')
    })
  },
  actions: handlers.actions({
    /** The running terminals, answered to the window that asked as it starts */
    sendConnectedData: ({ reply }) => {
      answer(reply, { type: 'terminal.TERMINALS_LISTED', data: terminalService.list() })
    },

    createTerminal: ({ event, context, reply, client }) => {
      const ev = event as {
        type: 'terminal.CREATE_TERMINAL';
        title?: string;
        cwd?: string;
        shell?: string;
        cols?: number;
        rows?: number;
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
      }, terminalHandlers, client).then(terminalInfo => {
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
        void terminalService.kill(ev.terminalId)
          .then(found => {
            if (!found) failTerminal(reply, 'close', `${terminalName} not found`, ev.terminalId)
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
      const ev = event as { type: 'terminal.RESIZE_TERMINAL'; terminalId: string; cols: number; rows: number }
      try {
        const terminal = terminalService.get(ev.terminalId)
        const terminalName = terminal ? terminal.info.title : 'Terminal'
        // **Awaited, not checked for truth.** The service answers a promise now, and `if (!promise)` is
        // never true — the refusal below was dead the moment the broker owned the process.
        // **The window that opened it owns its size** (M2): a second window's fit is ignored, because a pty
        // has one `(cols, rows)` and two windows fitting it to their own widths is a contradiction rather
        // than a race. `client` names the connection the message arrived on, which the API stamps and
        // nobody can forge.
        void terminalService.resize(ev.terminalId, ev.cols, ev.rows, client)
          .then(found => {
            if (!found) failTerminal(reply, 'resize', `${terminalName} not found`, ev.terminalId)
          })
          .catch(error => failTerminal(reply, 'resize', error, ev.terminalId))
      } catch (error) {
        failTerminal(reply, 'resize', error, ev.terminalId)
      }
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
        }
      }
    }
  }
})