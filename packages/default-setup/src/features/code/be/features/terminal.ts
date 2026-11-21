import { featureSettings } from '#generated/settings.ts';
import type { OutgoingTerminalEvents, TerminalAsks } from '../contract.ts'

import { broadcast, tell } from '#generated/events.ts';
import { defineHandlers } from '@apackdev/sdk/framework';
import { safeEvents } from '@apackdev/sdk/helpers';
import { setup, assign, fromPromise, waitFor, type AnyActorRef } from 'xstate'

import { terminalService } from '../services/terminal.ts'
import { cwdAsReported } from '../utils/osc-cwd.ts'
import { statusMoves } from '../utils/terminal-status.ts'
import type { TerminalEvent } from '@apackdev/sdk/services'
import { createLogger, reportError } from '@apackdev/sdk/logger';
import { onConnectionEnded, type AsksEvents } from '@apackdev/sdk/events';

const logger = createLogger('terminal');

const surfaceId = 'code' as const

export interface CodeTerminalSystemContext {
  baseDirectory: string | null
}

/** What the terminal child handles: a window's input that nobody answers, the code system's own, and the asks */
export type Event =
  | { type: 'terminal.TERMINAL_INPUT'; terminalId: string; data: string }
  | { type: 'terminal.STOPPED_FITTING'; terminalId: string }
  | { type: 'terminal.STATUS_SEEN'; terminalId: string }
  | { type: 'terminal.REWIND_CLOSE'; session: string }
  /** The window looking back through a recording measured how many cells fit where it draws it */
  | { type: 'terminal.REWIND_RESIZE'; session: string; cols: number; rows: number }
  | { type: 'terminal.UPDATE_BASE_DIRECTORY'; path: string }
  // The terminal asks, which the code system forwards here to be answered
  | AsksEvents<TerminalAsks>

const typeOf = safeEvents<Event>();

/** A terminal's news, for every window showing the code surface: what its process did, never a listing */
type TerminalNewsType = 'terminal.CWD_CHANGED' | 'terminal.CLIPBOARD' | 'terminal.BELL' | 'terminal.NOTIFIED'
  | 'terminal.PROGRESS' | 'terminal.TITLED' | 'terminal.CLOSED' | 'terminal.CREATED'
  | 'terminal.CRASHED' | 'terminal.RESTARTED' | 'terminal.RESIZED' | 'terminal.KEPT' | 'terminal.STATUS'
type TerminalNews = Extract<OutgoingTerminalEvents, { type: TerminalNewsType }>

/** Tell every window showing the code surface what a terminal did */
const emitToFrontend = (event: TerminalNews) => {
  broadcast(surfaceId, event)
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
 * The bells this backend process has emitted. The id is unique within a run, which is all a bell's identity needs:
 * the main process forgets a shown id within a minute, and no terminal keeps its id across a restart.
 */
let bellCount = 0

/**
 * Where a terminal's news and its exit go — **given to the service before the session exists**, not
 * registered after it returns, so nothing a shell does first has nowhere to go.
 */
const terminalHandlers = {
  onEvent(terminalId: string, event: TerminalEvent) {
    switch (event.kind) {
      // A command that finished may have changed the repository or an open file with no file event for it
      case 'commandFinished':
        tell('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' })
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
        emitToFrontend({ type: 'terminal.BELL', data: { terminalId, bellId: `${terminalId}#${++bellCount}` } })
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
      // **What the terminal's programs say they are doing** (OSC 7501): shown, and never acted on for them.
      // Two things follow from a change, neither of which answers the program. A record leaving `working`
      // is an agent's turn ending as far as anything says, and it may have changed the repository with no
      // file event for it — the same hint a finished command gives. And a flow may be waiting to hear
      case 'programStatus': {
        const heard = terminalService.heardStatuses(terminalId, event.statuses)
        if (!heard) break
        emitToFrontend({ type: 'terminal.STATUS', data: { terminalId, statuses: heard.after } })
        const { moves, leftWorking } = statusMoves(heard.before, heard.after)
        if (leftWorking) tell('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' })
        for (const { record, previous } of moves) {
          // A record naming a program that is not the one in front is drawn as such and tells no flow:
          // a flow acts on what it hears
          if (record.confirmed === 'mismatched') continue
          tell({ role: 'brain' }, {
            type: 'TRIGGER_BRAIN_EVENT',
            eventType: 'terminal.status',
            payload: { terminalId, id: record.id, app: record.app, state: record.state, kind: record.kind, previous },
          })
        }
        break
      }
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
 * A failure of something nobody asked for, reported to the user: keystrokes for a terminal that is not there.
 * `reportError` is what reaches them, the app turning a system error into a toast. An ask's failure is not
 * reported here: it is its asker's, which the ask's answer tells
 */
const failTerminal = (operation: string, error: unknown): void => {
  reportError({ error, title: 'Terminal error', source: 'terminal', operation })
}

/** A terminal's title, for saying which one was not found */
const nameOf = (terminalId: string) => terminalService.get(terminalId)?.info.title ?? 'Terminal'

/**
 * The terminals as restored: an ask about them waits until this machine has taken up what the last run left, rather
 * than being answered from a list that is still being filled
 */
async function restored(self: AnyActorRef): Promise<void> {
  await waitFor(self, snapshot => snapshot.value === 'idle')
}

/** Hands each handler the connection the message it handles arrived on — see `defineHandlers` */
const handlers = defineHandlers<CodeTerminalSystemContext, Event>();

/**
 * The terminal asks, answered here. One that fails is refused with what it failed with, which is its asker's to
 * show; one nobody asked for is reported by the answer itself
 */
const answers = handlers.answers<TerminalAsks>({
  // **The answer waits for the session**, because the process is the broker's and a socket away
  'terminal.CREATE_TERMINAL': async ({ args, context, self }) => {
    await restored(self)
    const cwd = args.cwd || context.baseDirectory
    const terminalInfo = await terminalService.create({
      title: args.title,
      cwd: cwd && cwd.trim() ? cwd : undefined,
      shell: args.shell,
      cols: args.cols || 80,
      rows: args.rows || 24,
      target: args.target,
    }, terminalHandlers)
    // Every window's list grows, and only the window that asked opens it. A terminal's id is minted here, so
    // nothing the asker sent could have identified it
    emitToFrontend({ type: 'terminal.CREATED', data: { terminalId: terminalInfo.id } })
    return terminalInfo
  },

  'terminal.RESTART_TERMINAL': async ({ args: { terminalId }, self }) => {
    await restored(self)
    const info = await terminalService.restart(terminalId, terminalHandlers)
    if (!info) throw new Error(`No terminal ${terminalId}`)
    // Every window showing this terminal has a new shell under it; the one that asked hears it too, which is why
    // this is news rather than the answer — a restart is not private to the window that clicked it
    emitToFrontend({ type: 'terminal.RESTARTED', data: info })
  },

  'terminal.CLOSE_TERMINAL': async ({ args: { terminalId }, self }) => {
    await restored(self)
    const terminalName = nameOf(terminalId)
    const outcome = await terminalService.kill(terminalId, terminalHandlers)
    // Only one of these is a terminal that was not there. A broker that would not end the session closed the
    // terminal all the same, so the user is told what happened rather than that they asked about something
    // that does not exist
    if (outcome === 'unknown') throw new Error(`${terminalName} not found`)
    if (outcome === 'refused') throw new Error(`The broker would not end ${terminalName}; it is closed here`)
  },

  'terminal.RESIZE_TERMINAL': async ({ args, client }) => {
    // One cell in pixels, where the window measured one: what a program asking for the size in pixels is told
    const cell = args.cellWidth && args.cellHeight ? { width: args.cellWidth, height: args.cellHeight } : undefined
    const terminalName = nameOf(args.terminalId)
    // **Every window's fit is recorded, and the pty runs at the smallest** (`TerminalService.resize`): a pty has
    // one `(cols, rows)`, and the smallest fit is the one every window showing it can draw whole. `client` names
    // the connection the ask arrived on, which the API stamps and nobody can forge.
    const accepted = await terminalService.resize(args.terminalId, args.cols, args.rows, client, cell)
    if (!accepted) throw new Error(`${terminalName} not found`)
    const grid = { terminalId: args.terminalId, cols: accepted.cols, rows: accepted.rows }
    // **The grid moved, so every window showing this terminal needs it** — each renders the accepted one rather
    // than whatever it fitted for itself, which is what stops a second window drawing at a size nothing agreed to
    if (accepted.changed) emitToFrontend({ type: 'terminal.RESIZED', data: grid })
    // The asker that did not get what it asked for is told by its answer, which is its business and nobody else's
    return accepted.cols !== args.cols || accepted.rows !== args.rows ? grid : null
  },

  'terminal.RENAME_TERMINAL': ({ args: { terminalId, customTitle } }) => {
    if (!terminalService.rename(terminalId, customTitle)) throw new Error(`${nameOf(terminalId)} not found`)
    broadcast(surfaceId, { type: 'terminal.RENAMED', data: { terminalId, customTitle } })
  },

  'terminal.REFRESH_LIST': async ({ self }) => {
    await restored(self)
    return terminalService.list()
  },

  'terminal.OPEN_TERMINAL_TAB': async ({ args: { terminalId }, self }) => {
    await restored(self)
    const terminal = terminalService.list().find(t => t.id === terminalId)
    if (!terminal) throw new Error('Terminal not found')
    return terminal
  },

  /** Every window showing the terminal marks it as one that keeps running, which is news rather than the answer */
  'terminal.KEEP_TERMINAL': async ({ args: { terminalId, kept }, self }) => {
    await restored(self)
    if (!await terminalService.keep(terminalId, kept)) throw new Error(`No running terminal ${terminalId}`)
    emitToFrontend({ type: 'terminal.KEPT', data: { terminalId, kept } })
  },

  /** A recording is opened for the window that asked to look, and nobody else is looking */
  'terminal.REWIND': async ({ args: { terminalId, cols, rows }, client, self }) => {
    await restored(self)
    const opened = await terminalService.rewind(terminalId, { cols, rows }, client)
    if (!opened) throw new Error(`No terminal ${terminalId}`)
    return opened
  },

  'terminal.REWIND_SEEK': async ({ args: { session, at }, self }) => {
    await restored(self)
    const sought = await terminalService.seekRewind(session, at)
    return sought === null ? null : { session, at: sought }
  },
})

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
  actions: {
    ...answers.actions,
    ...handlers.actions({
    /** Keystrokes: a terminal that is not there is reported, and nothing is answered */
    sendTerminalInput: ({ event }) => {
      const ev = typeOf('terminal.TERMINAL_INPUT', event)
      const terminalName = nameOf(ev.terminalId)
      void terminalService.write(ev.terminalId, ev.data)
        .then(found => {
          if (!found) failTerminal('input', new Error(`${terminalName} not found`))
        })
        .catch(error => failTerminal('input', error))
    },

    /**
     * A window has stopped showing a terminal, so the grid may rise for the windows that still are.
     *
     * Broadcast and never answered: the sender is the window that just stopped drawing it, and the windows
     * that need the new grid are the others.
     */
    stoppedFitting: ({ event, client }) => {
      const ev = typeOf('terminal.STOPPED_FITTING', event)
      if (client === undefined) return
      void terminalService.stoppedFitting(ev.terminalId, client)
        .then(accepted => {
          if (!accepted?.changed) return
          emitToFrontend({ type: 'terminal.RESIZED', data: { terminalId: ev.terminalId, cols: accepted.cols, rows: accepted.rows } })
        })
        .catch(error => { logger.error(`Could not release ${ev.terminalId}'s fit`, { error }) })
    },

    /** News: what one window's person has looked at, every window stops marking */
    markStatusSeen: ({ event }) => {
      const ev = typeOf('terminal.STATUS_SEEN', event)
      const statuses = terminalService.statusesSeen(ev.terminalId)
      if (statuses) emitToFrontend({ type: 'terminal.STATUS', data: { terminalId: ev.terminalId, statuses } })
    },

    resizeRewind: ({ event }) => {
      const ev = typeOf('terminal.REWIND_RESIZE', event)
      void terminalService.resizeRewind(ev.session, ev.cols, ev.rows).catch(error => { logger.error('Could not resize a recording', { error }) })
    },

    closeRewind: ({ event }) => {
      const ev = typeOf('terminal.REWIND_CLOSE', event)
      void terminalService.closeRewind(ev.session).catch(error => { logger.error('Could not close a recording', { error }) })
    },

    updateBaseDirectory: assign({
      baseDirectory: ({ event }) => typeOf('terminal.UPDATE_BASE_DIRECTORY', event).path
    })
  }),
  },
}).createMachine({
  id: 'terminal',
  initial: 'initializing',
  context: ({ input }: { input?: { baseDirectory: string | null } }) => ({
    baseDirectory: input?.baseDirectory || null
  }),
  // Stateless handlers safe during initialization. The asks are taken in every state: those about the terminals
  // the restore takes up wait for it (`restored`), so they are answered from the list as restored
  on: {
    ...answers.on,
    'terminal.TERMINAL_INPUT': {
      actions: 'sendTerminalInput'
    },
    'terminal.STOPPED_FITTING': {
      actions: 'stoppedFitting'
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
        },
        // **A rejection with no `onError` stops the terminal system for the session** (L1), in silence: the
        // machine stays in `initializing`, so every ask waiting for the restore waits for ever and the
        // surface shows an empty list. Restoring is best-effort — what it restores is a convenience, and the
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
                error: event.error,
                title: 'Could not restore terminals',
                source: 'terminal',
                operation: 'restore',
              })
            },
          ],
        }
      }
    },
    idle: {
      on: {
        'terminal.STATUS_SEEN': {
          actions: 'markStatusSeen'
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
