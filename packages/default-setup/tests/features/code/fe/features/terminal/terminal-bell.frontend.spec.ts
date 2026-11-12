// What a terminal's bell does on the window: it flashes the terminal for a moment, a run of bells is one flash, the
// flash setting can turn the flash off, and a system notification is asked for only while the window is not focused.
// The state is the one that decides all of it; the component only paints the flash it reports.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

const sendToSystem = vi.hoisted(() => vi.fn())
vi.mock('#generated/events.ts', () => ({ sendToSystem }))
const parent = vi.hoisted(() => ({ updateParentState: vi.fn(), addTabToParent: vi.fn(), getParentContext: vi.fn(() => null), sendEventToParent: vi.fn() }))
vi.mock('#features/code/fe/utils/parent-communication.ts', () => parent)
const pool = vi.hoisted(() => ({ dispose: vi.fn(), syncProcesses: vi.fn(), noteExit: vi.fn(), describe: vi.fn() }))
vi.mock('#features/code/fe/utils/terminal-pool.ts', () => ({ terminalPool: pool }))

const { terminalState, BELL_FLASH_MS, BELL_WINDOW_MS } = await import('#features/code/fe/features/terminal/state.ts')

const aTerminal = (id: string) => ({ id, title: id, cwd: '/tmp', active: true }) as never
const bell = (terminalId: string) => ({ type: 'terminal.BELL', data: { terminalId } }) as never

/** A terminal whose code surface has these settings, and the flash and notification the window showed */
function window(settings: Record<string, unknown> = {}) {
  parent.getParentContext.mockReturnValue({ settings } as never)
  const actor = createActor(terminalState).start()
  actor.send({ type: 'terminal.TERMINALS_LISTED', data: [aTerminal('t-1'), aTerminal('t-2')] })
  // A flash begins where the terminal stops not flashing and starts: a change to some other field is not one
  const flashes: number[] = []
  let now = 0
  let wasFlashing = false
  actor.subscribe(() => {
    const flashing = actor.getSnapshot().context.bells['t-1'] === 'flashing'
    if (flashing && !wasFlashing) flashes.push(now)
    wasFlashing = flashing
  })
  return {
    bell: (terminalId = 't-1') => actor.send(bell(terminalId)),
    flashing: (terminalId = 't-1') => actor.getSnapshot().context.bells[terminalId] === 'flashing',
    /** When each flash began, in ms from the first bell */
    flashStarts: () => flashes.slice(),
    advance: async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms) },
  }
}

let notify: ReturnType<typeof vi.fn>
let hasFocus: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  sendToSystem.mockReset()
  pool.dispose.mockReset()
  parent.getParentContext.mockReset()
  notify = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('electronAPI', { notify: { show: notify } })
  hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a bell on the window', () => {
  it('flashes the terminal for 150 ms, then the flash is over', async () => {
    const w = window()
    w.bell()
    expect(w.flashing(), 'a bell did not flash').toBe(true)
    await w.advance(BELL_FLASH_MS - 1)
    expect(w.flashing(), 'the flash ended early').toBe(true)
    await w.advance(1)
    expect(w.flashing(), 'the flash did not end after 150 ms').toBe(false)
  })

  it('flashes once for a run of bells inside 500 ms, and a bell during the flash does not restart it', async () => {
    const w = window()
    w.bell()
    await w.advance(100)
    w.bell()
    await w.advance(BELL_FLASH_MS - 100)
    expect(w.flashing(), 'the second bell restarted the flash').toBe(false)
    await w.advance(BELL_WINDOW_MS - BELL_FLASH_MS - 100)
    w.bell()
    expect(w.flashStarts(), 'bells inside 500 ms painted more than one flash').toEqual([0])
  })

  it('flashes again for a bell after the 500 ms window has closed', async () => {
    const w = window()
    w.bell()
    await w.advance(BELL_WINDOW_MS)
    w.bell()
    expect(w.flashStarts()).toEqual([0, BELL_WINDOW_MS])
  })

  it('paints nothing when the flash setting is off, and still counts the window for its notification', async () => {
    const w = window({ bellFlash: false })
    w.bell()
    expect(w.flashing()).toBe(false)
    await w.advance(BELL_FLASH_MS)
    expect(w.flashStarts()).toEqual([])
  })

  it('flashes a bell on a terminal of its own, not the others', () => {
    const w = window()
    w.bell('t-2')
    expect(w.flashing('t-1')).toBe(false)
    expect(w.flashing('t-2')).toBe(true)
  })

  it('asks for a system notification when the window is not focused and the setting is on', () => {
    hasFocus.mockReturnValue(false)
    window({ bellNotification: true }).bell()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Terminal', 'Rang the bell')
  })

  it('does not ask for a system notification while the window is focused', () => {
    hasFocus.mockReturnValue(true)
    window({ bellNotification: true }).bell()
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not ask for a system notification when the setting is off, which is its default', () => {
    hasFocus.mockReturnValue(false)
    window({}).bell()
    window({ bellNotification: false }).bell()
    expect(notify).not.toHaveBeenCalled()
  })

  it('asks for one notification for a run of bells inside 500 ms', () => {
    hasFocus.mockReturnValue(false)
    const w = window({ bellNotification: true })
    w.bell()
    w.bell()
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
