// What a terminal's tab shows that its screen does not — a bell, a notification, progress, that it keeps
// running — and the recording a window opens to look back through one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

const sendToSystem = vi.hoisted(() => vi.fn())
vi.mock('#generated/events.ts', () => ({ sendToSystem }))
const parent = vi.hoisted(() => ({ updateParentState: vi.fn(), addTabToParent: vi.fn(), getParentContext: vi.fn(() => null), sendEventToParent: vi.fn() }))
vi.mock('#features/code/fe/utils/parent-communication.ts', () => parent)
const pool = vi.hoisted(() => ({ dispose: vi.fn(), syncProcesses: vi.fn(), noteExit: vi.fn(), describe: vi.fn() }))
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: pool }))

const { terminalState } = await import('#features/code/fe/features/terminal/state.ts')

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp', active: true }) as never
const sent = () => sendToSystem.mock.calls.map(([, event]) => event)

function started() {
  const actor = createActor(terminalState).start()
  actor.send({ type: 'terminal.TERMINALS_LISTED', data: [aTerminal('t-1'), aTerminal('t-2')] })
  sendToSystem.mockClear()
  return { actor, activity: () => actor.getSnapshot().context.activity, context: () => actor.getSnapshot().context }
}

beforeEach(() => {
  sendToSystem.mockReset()
  pool.dispose.mockReset()
})
afterEach(() => { vi.unstubAllGlobals() })

describe("what a terminal's program says off its screen", () => {
  it('marks its tab until the person looks at it, and only its own', () => {
    const { actor, activity } = started()
    actor.send({ type: 'terminal.BELL', data: { terminalId: 't-1' } })
    actor.send({ type: 'terminal.NOTIFIED', data: { terminalId: 't-1', title: 'Build', body: 'finished' } })
    actor.send({ type: 'terminal.BELL', data: { terminalId: 't-2' } })
    expect(activity()).toEqual({ 't-1': { bell: true, notification: { title: 'Build', body: 'finished' } }, 't-2': { bell: true } })

    actor.send({ type: 'terminal.SEEN', terminalId: 't-1' })
    expect(activity()).toEqual({ 't-1': {}, 't-2': { bell: true } })
  })

  it('shows how far along it says it is, until it says it is done, and that outlasts being looked at', () => {
    const { actor, activity } = started()
    actor.send({ type: 'terminal.PROGRESS', data: { terminalId: 't-1', state: 'running', percent: 40 } })
    actor.send({ type: 'terminal.SEEN', terminalId: 't-1' })
    expect(activity()['t-1']).toEqual({ progress: { state: 'running', percent: 40 } })
    actor.send({ type: 'terminal.PROGRESS', data: { terminalId: 't-1', state: 'none', percent: null } })
    expect(activity()['t-1']).toEqual({})
  })

  it('keeps the name it gave its terminal, until it takes the name back', () => {
    const { actor, activity } = started()
    actor.send({ type: 'terminal.TITLED', data: { terminalId: 't-1', title: 'vim notes.md' } })
    expect(activity()['t-1']).toEqual({ title: 'vim notes.md' })
    actor.send({ type: 'terminal.TITLED', data: { terminalId: 't-1', title: '' } })
    expect(activity()['t-1']).toEqual({})
  })

  it('tells the person through the system only when this window is not the one they are looking at', () => {
    const raised: Array<[string, string | undefined]> = []
    class Notification {
      static permission = 'granted'
      constructor(title: string, options?: { body?: string }) { raised.push([title, options?.body]) }
    }
    vi.stubGlobal('Notification', Notification)
    const focused = vi.spyOn(document, 'hasFocus')
    const { actor } = started()

    focused.mockReturnValue(true)
    actor.send({ type: 'terminal.NOTIFIED', data: { terminalId: 't-1', title: 'Seen', body: 'already' } })
    expect(raised, 'raised over the terminal that said it').toEqual([])

    focused.mockReturnValue(false)
    actor.send({ type: 'terminal.NOTIFIED', data: { terminalId: 't-1', title: 'Build', body: 'finished' } })
    expect(raised).toEqual([['Build', 'finished']])
    focused.mockRestore()
  })

  it('is forgotten with the terminal', () => {
    const { actor, activity } = started()
    actor.send({ type: 'terminal.BELL', data: { terminalId: 't-1' } })
    actor.send({ type: 'terminal.CLOSED', data: { terminalId: 't-1' } })
    expect(activity()).toEqual({})
  })
})

describe('a terminal that keeps running', () => {
  it('is asked for of the backend, and marked when the backend says it is', () => {
    const { actor, context } = started()
    actor.send({ type: 'terminal.KEEP', terminalId: 't-1', kept: true })
    expect(sent()).toEqual([{ type: 'terminal.KEEP_TERMINAL', terminalId: 't-1', kept: true }])
    expect(context().terminals.find(({ id }) => id === 't-1')?.kept, 'marked before the backend agreed').toBeUndefined()

    actor.send({ type: 'terminal.KEPT', data: { terminalId: 't-1', kept: true } })
    expect(context().terminals.map(({ id, kept }) => [id, kept])).toEqual([['t-1', true], ['t-2', undefined]])
  })
})

describe('looking back through a terminal', () => {
  it('opens at the end, follows the moment the backend says is shown, and closes its view', () => {
    const { actor, context } = started()
    actor.send({ type: 'terminal.REWIND', terminalId: 't-1', cols: 90, rows: 30 })
    expect(sent()).toEqual([{ type: 'terminal.REWIND', terminalId: 't-1', cols: 90, rows: 30 }])
    expect(context().rewind).toBeNull()

    actor.send({ type: 'terminal.REWOUND', data: { terminalId: 't-1', session: 'r-4', first: 100, last: 900 } })
    expect(context().rewind).toEqual({ terminalId: 't-1', session: 'r-4', first: 100, last: 900, at: 900 })

    sendToSystem.mockClear()
    actor.send({ type: 'terminal.REWIND_SEEK', at: 450 })
    expect(sent()).toEqual([{ type: 'terminal.REWIND_SEEK', session: 'r-4', at: 450 }])
    // The answer for a recording this window no longer has open says nothing about the one it has
    actor.send({ type: 'terminal.REWIND_SOUGHT', data: { session: 'r-3', at: 1 } })
    expect(context().rewind?.at).toBe(900)
    actor.send({ type: 'terminal.REWIND_SOUGHT', data: { session: 'r-4', at: 450 } })
    expect(context().rewind?.at).toBe(450)

    sendToSystem.mockClear()
    actor.send({ type: 'terminal.REWIND_CLOSE' })
    expect(sent()).toEqual([{ type: 'terminal.REWIND_CLOSE', session: 'r-4' }])
    expect(pool.dispose).toHaveBeenCalledWith('rewind:r-4')
    expect(context().rewind).toBeNull()
    // And closing what is not open asks nothing
    sendToSystem.mockClear()
    actor.send({ type: 'terminal.REWIND_CLOSE' })
    expect(sent()).toEqual([])
  })
})

describe("what a program's clipboard write does in a window", () => {
  it('is handed to the main process, whether or not this window has the focus', () => {
    const writeText = vi.fn(() => Promise.resolve(true))
    vi.stubGlobal('electronAPI', { clipboard: { writeText } })
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { actor } = started()

    actor.send({ type: 'terminal.CLIPBOARD', data: { terminalId: 't-1', text: 'copied by a program' } })
    expect(writeText).toHaveBeenCalledWith('copied by a program')

    focused.mockRestore()
  })

  it('that the main process refuses, or fails to take, leaves the window as it was: no error reaches it', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('ipc failed')))
    vi.stubGlobal('electronAPI', { clipboard: { writeText } })
    const { actor } = started()

    expect(() => actor.send({ type: 'terminal.CLIPBOARD', data: { terminalId: 't-1', text: 'x' } })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writeText).toHaveBeenCalledWith('x')
  })
})
