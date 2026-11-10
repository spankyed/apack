// The pool: which session each terminal is drawn from, where it is mounted, and what a host is told.
//
// A window draws a terminal with a view of its session. What is this module's own is the bookkeeping
// around that view — one for a terminal however many hosts show it in turn, a new one when the shell under
// a terminal is replaced, the fit a pty is told once it has settled — and that is what these drive, over a
// stand-in that records what a real view would have been asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFeTestRuntime } from '@apackdev/sdk/testing'

vi.mock('apack-terminal-view', async () => (await import('../_support/terminal-view.ts')).viewModule())

const { views, lastView, connections } = await import('../_support/terminal-view.ts')
const { terminalInfo } = await import('../_support/terminal-host.ts')
const { terminalPool, RESIZE_SETTLE_MS } = await import('#features/code/fe/utils/terminal-pool.ts')

let stopRuntime: (() => void) | undefined
let next = 0
const made: string[] = []
/** A terminal of this case's own: the pool is a module singleton, so two cases must not share one */
function terminal(fields: Parameters<typeof terminalInfo>[1] = {}) {
  const info = terminalInfo(`pool-${(next += 1)}`, fields)
  made.push(info.id)
  return info
}
const host = () => document.body.appendChild(document.createElement('div'))

beforeEach(() => {
  stopRuntime = startFeTestRuntime()
  views.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  for (const id of made.splice(0)) terminalPool.dispose(id)
  stopRuntime?.()
  document.body.replaceChildren()
})

describe('a terminal in the pool', () => {
  it('is drawn by one view of its session, made once however often it is asked for', () => {
    const info = terminal()
    const entry = terminalPool.ensure(info)
    expect(terminalPool.ensure(info)).toBe(entry)
    expect(views.map((view) => view.session)).toEqual([info.session])
    expect(lastView().element.dataset.apackTerminal, 'a page cannot find the terminal by its id').toBe(info.id)
  })

  it('is mounted only while a host has it, so a terminal nobody is looking at is sent nothing', () => {
    const info = terminal()
    terminalPool.ensure(info)
    expect(lastView().mountedIn, 'a view was mounted before any host asked for it').toBeNull()

    const attachment = terminalPool.attach(info.id, host())!
    expect(lastView().mountedIn).not.toBeNull()

    expect(attachment.release()).toBe(true)
    expect(lastView().mountedIn).toBeNull()
    expect(lastView().disposed, 'letting go of a terminal ended its view').toBe(false)
  })

  /**
   * During a remount the new host attaches before the old one releases. The old one's release must detach
   * nothing and say so, or it would take the terminal off the screen and tell the backend to drop a fit
   * the new host had just recorded.
   */
  it('goes to the newest host, whose predecessor then lets go of nothing', () => {
    const info = terminal()
    terminalPool.ensure(info)
    const first = terminalPool.attach(info.id, host())!
    const second = host()
    const taken = terminalPool.attach(info.id, second)!

    expect(first.release(), 'a host that was taken over from let the terminal go').toBe(false)
    expect(second.contains(lastView().element), 'the terminal left the host that has it').toBe(true)
    expect(taken.release()).toBe(true)
    expect(taken.release(), 'a second release let go again').toBe(false)
  })

  it('is not there to attach to once it has been disposed', () => {
    const info = terminal()
    terminalPool.ensure(info)
    terminalPool.dispose(info.id)
    expect(lastView().disposed).toBe(true)
    expect(terminalPool.attach(info.id, host())).toBeNull()
  })
})

describe('a shell replaced under a terminal', () => {
  it('is drawn by a new view of the new session, in the host the old one was in, and said to be new', () => {
    const info = terminal()
    terminalPool.ensure(info)
    const shown = host()
    terminalPool.attach(info.id, shown)
    const old = lastView()

    terminalPool.noteRestart({ ...info, session: 'the-new-session', pid: 9001, generation: 2 })

    expect(old.disposed, 'the view of a session that is gone was kept').toBe(true)
    expect(lastView().session).toBe('the-new-session')
    expect(shown.contains(lastView().element), 'the new shell is not drawn where the old one was').toBe(true)
    const notice = shown.querySelector<HTMLElement>('[data-terminal-notice="restarted"]')
    expect(notice?.textContent).toContain('pid 9001')
  })

  it('is learned from the list too, which is how a window that was not watching finds out', () => {
    const info = terminal()
    terminalPool.ensure(info)
    terminalPool.syncProcesses([{ ...info, session: 'after-a-restart' }, terminalInfo('pool-unknown')])
    expect(views.map((view) => view.session)).toEqual([info.session, 'after-a-restart'])

    // The same session again is the same shell: nothing is replaced
    terminalPool.syncProcesses([{ ...info, session: 'after-a-restart' }])
    expect(views).toHaveLength(2)
  })

  it('that ended and was kept says so over the screen it left, and has no view once it is listed without a session', () => {
    const info = terminal()
    terminalPool.ensure(info)
    const shown = host()
    terminalPool.attach(info.id, shown)

    terminalPool.noteExit(info.id, 139)
    expect(shown.querySelector('[data-terminal-notice="ended"]')?.textContent).toContain('status 139')
    expect(lastView().disposed, 'the screen a crashed shell left was taken away with it').toBe(false)

    terminalPool.noteExit(info.id, null)
    expect(shown.querySelector('[data-terminal-notice="ended"]')?.textContent).toContain('a signal')
  })

  it('that had already ended when the window first saw it is said to have', () => {
    const info = terminal({ session: undefined, active: false, exited: { code: 2 } })
    terminalPool.ensure(info)
    const shown = host()
    terminalPool.attach(info.id, shown)
    expect(views, 'a view was made of a terminal with no session').toEqual([])
    expect(shown.querySelector('[data-terminal-notice="ended"]')?.textContent).toContain('status 2')
  })
})

describe('what a host is told', () => {
  it('is the fit once it has settled, so a drag is one resize of the pty and not one a frame', async () => {
    vi.useFakeTimers()
    const info = terminal()
    terminalPool.ensure(info)
    const sizes: unknown[] = []
    terminalPool.attach(info.id, host(), { onResize: (size) => { sizes.push(size) } })

    lastView().reportFit(100, 30)
    expect(sizes, 'the first fit waited').toEqual([{ cols: 100, rows: 30, cellWidth: 8, cellHeight: 16 }])

    for (let cols = 101; cols <= 120; cols += 1) lastView().reportFit(cols, 30)
    expect(sizes, 'fits inside the settling window were sent as they came').toHaveLength(1)
    await vi.advanceTimersByTimeAsync(RESIZE_SETTLE_MS)
    expect(sizes.at(-1), 'the fit it settled on is not the one that was sent').toMatchObject({ cols: 120, rows: 30 })
    expect(sizes).toHaveLength(2)
  })

  it('is nothing once it has let go, even of a fit that was still settling', async () => {
    vi.useFakeTimers()
    const info = terminal()
    terminalPool.ensure(info)
    const sizes: unknown[] = []
    const attachment = terminalPool.attach(info.id, host(), { onResize: (size) => { sizes.push(size) } })!
    lastView().reportFit(100, 30)
    lastView().reportFit(110, 30)
    attachment.release()
    await vi.advanceTimersByTimeAsync(RESIZE_SETTLE_MS * 2)
    expect(sizes).toHaveLength(1)
  })

  it('is whether the terminal is following its output, starting from where the last host left it', () => {
    const info = terminal()
    terminalPool.ensure(info)
    const heard: boolean[] = []
    const first = terminalPool.attach(info.id, host(), { onFollowingChange: (following) => { heard.push(following) } })!
    lastView().reportFollowing(false)
    first.release()

    const again: boolean[] = []
    terminalPool.attach(info.id, host(), { onFollowingChange: (following) => { again.push(following) } })
    expect(heard).toEqual([true, false])
    expect(again, 'a host that takes a scrolled-back terminal was told it is following').toEqual([false])
    expect(terminalPool.isFollowingOutput(info.id)).toBe(false)
  })

  it('reaches the view for everything else a host can ask of a terminal', async () => {
    const info = terminal()
    terminalPool.ensure(info)
    const selected: boolean[] = []
    const attachment = terminalPool.attach(info.id, host(), { onSelectionChange: (has) => { selected.push(has) } })!
    lastView().reportSelection(true)

    attachment.focus()
    attachment.refit()
    attachment.followOutput()
    attachment.clear()
    attachment.selectAll()
    attachment.paste('pasted text')
    expect(await attachment.copy()).toBe(true)

    const view = lastView()
    expect([view.focused, view.fits, view.followed, view.cleared, view.selectedAll, view.copies]).toEqual([1, 1, 1, 1, 1, 1])
    expect(view.pasted).toEqual(['pasted text'])
    expect(selected).toEqual([true])
  })
})

describe('finding text in a terminal', () => {
  const bar = (within: HTMLElement) => within.querySelector<HTMLElement>('[data-terminal-find]')
  const typeInto = (input: HTMLInputElement, text: string) => {
    input.value = text
    input.dispatchEvent(new Event('input'))
  }
  const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))

  it('asks the session, says which match of how many, and steps through them', async () => {
    const info = terminal()
    terminalPool.ensure(info)
    const mountedIn = host()
    const attachment = terminalPool.attach(info.id, mountedIn)!
    const view = lastView()
    view.matches = 3

    attachment.find()
    const input = bar(mountedIn)!.querySelector('input')!
    expect(document.activeElement, 'the person has to click before they can type what to find').toBe(input)
    typeInto(input, 'error')
    await vi.waitFor(() => { expect(bar(mountedIn)!.querySelector('[data-terminal-find-count]')!.textContent).toBe('1 of 3') })
    expect(view.searches).toEqual(['error'])

    press(input, 'Enter')
    expect(bar(mountedIn)!.querySelector('[data-terminal-find-count]')!.textContent).toBe('2 of 3')
    press(input, 'Enter', { shiftKey: true })
    expect(bar(mountedIn)!.querySelector('[data-terminal-find-count]')!.textContent).toBe('1 of 3')

    view.matches = 0
    typeInto(input, 'nowhere')
    await vi.waitFor(() => { expect(bar(mountedIn)!.querySelector('[data-terminal-find-count]')!.textContent).toBe('No results') })
  })

  it('closes on Escape, with nothing left marked and the terminal typed at again', async () => {
    const info = terminal()
    terminalPool.ensure(info)
    const mountedIn = host()
    const attachment = terminalPool.attach(info.id, mountedIn)!
    const view = lastView()
    attachment.find()
    typeInto(bar(mountedIn)!.querySelector('input')!, 'x')
    press(bar(mountedIn)!.querySelector('input')!, 'Escape')

    expect(bar(mountedIn)).toBeNull()
    expect(view.searches.at(-1), 'the matches of a search nobody is looking at stayed marked').toBe('')
    expect(view.focused).toBe(1)
    // Asked for again, there is one bar and not two
    attachment.find()
    attachment.find()
    expect(mountedIn.querySelectorAll('[data-terminal-find]')).toHaveLength(1)
  })

  it('opens on the app\'s key and leaves the shell\'s own Control-F to the shell', () => {
    const info = terminal()
    terminalPool.ensure(info)
    const mountedIn = host()
    terminalPool.attach(info.id, mountedIn)
    const key = (init: KeyboardEventInit) => lastView().options.onKey!(new KeyboardEvent('keydown', { code: 'KeyF', ...init }))

    expect(key({ ctrlKey: true }), 'readline never saw its own key').toBe(false)
    expect(bar(mountedIn)).toBeNull()
    expect(key({ ctrlKey: true, shiftKey: true })).toBe(true)
    expect(bar(mountedIn)).not.toBeNull()
  })
})

describe('what a program printed', () => {
  it('opens as the file it names: against the shell\'s directory, without the line a compiler put after it', () => {
    const info = terminal({ cwd: '/work/app' })
    terminalPool.ensure(info)
    const opened: Array<[string, number | undefined]> = []
    terminalPool.attach(info.id, host(), { onOpenPath: (path, line) => { opened.push([path, line]) } })
    const click = (target: string) => lastView().options.onLink!({ kind: 'path', target, start: 0, end: 0 } as never, new MouseEvent('click'))

    click('src/main.ts:12:5')
    click('./lib/../README.md')
    click('/etc/hosts:3')
    expect(opened).toEqual([['/work/app/src/main.ts', 12], ['/work/app/README.md', undefined], ['/etc/hosts', 3]])
  })

  it('is copied as the output of the last command that finished', async () => {
    const info = terminal()
    terminalPool.ensure(info)
    const attachment = terminalPool.attach(info.id, host())!
    const view = lastView()
    expect(attachment.hasCommands()).toBe(false)
    expect(await attachment.copyLastOutput(), 'a shell that marks no commands had one to copy').toBe(false)

    const command = (id: number, finishedMs: number | null) =>
      ({ id, command: `c${id}`, cwd: null, startedMs: 1, finishedMs, exitStatus: finishedMs === null ? null : 0, prompt: id * 10, output: id * 10 + 1, end: null })
    view.commands = [command(1, 5), command(2, 9), command(3, null)]
    expect(attachment.hasCommands()).toBe(true)
    expect(await attachment.copyLastOutput()).toBe(true)
    // The one still running has printed only part of what it will
    expect(view.selectedOutputs).toEqual([2])
    expect(view.copies).toBe(1)
  })
})

describe('the window\'s connection to the broker', () => {
  it('is one for every terminal it draws, and closed when the surface lets all of them go', () => {
    const before = { ...connections }
    terminalPool.disposeAll()
    const closedBefore = connections.closed
    terminalPool.ensure(terminal())
    terminalPool.ensure(terminal())
    expect(connections.opened - before.opened, 'each terminal opened a connection of its own').toBe(1)

    terminalPool.disposeAll()
    expect(connections.closed - closedBefore).toBe(1)
    expect(views.every((view) => view.disposed)).toBe(true)
    made.length = 0
  })

  it('is one for each broker its terminals are on, asked for by the target a terminal names', () => {
    // A stream that says which broker it was asked for, where the default one is to none at all
    stopRuntime?.()
    stopRuntime = startFeTestRuntime({
      terminalViews: (target) => Object.assign({ send() {}, onData: () => () => {}, onClose: () => () => {}, close() {} }, { target }),
    })
    const before = connections.opened
    terminalPool.ensure(terminal())
    terminalPool.ensure(terminal({ target: { id: 'tt_1', label: 'devbox', key: 'aaaaaaaaaaaa' } }))
    terminalPool.ensure(terminal({ target: { id: 'tt_1', label: 'devbox', key: 'aaaaaaaaaaaa' } }))
    terminalPool.ensure(terminal({ target: { id: 'tt_2', label: 'box', key: 'bbbbbbbbbbbb' } }))
    expect(connections.opened - before, 'two terminals on one target each opened a connection to it').toBe(3)
    expect(connections.targets.slice(-3)).toEqual([undefined, 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
  })
})
