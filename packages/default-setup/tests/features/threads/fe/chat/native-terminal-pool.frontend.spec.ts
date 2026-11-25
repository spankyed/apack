const f = vi.hoisted(() => ({
  views: [] as any[],
  connections: [] as any[],
  streams: [] as any[],
  sources: [] as any[],
}))
vi.mock('@apackdev/sdk/fe', async () => {
  const { fakeStream } = await import('../../../code/fe/_support/terminal-view.ts')
  return {
    terminalViews: vi.fn((target?: string) => {
      const stream = fakeStream(target)
      f.streams.push(stream)
      return stream
    }),
  }
})
vi.mock('@apackdev/terminal-view', async (importOriginal) => ({
  ...await importOriginal<typeof import('@apackdev/terminal-view')>(),
  BrokerViews: class {
    sources: any[] = []
    open = vi.fn((id: string) => {
      let listener: any
      const source = {
        id,
        key: vi.fn(), text: vi.fn(), paste: vi.fn(async () => 'pasted'), pointer: vi.fn(), focus: vi.fn(),
        attach: vi.fn(value => { listener = value; return source.detach }), detach: vi.fn(),
        acknowledge: vi.fn(), image: vi.fn(async () => ({ generation: 1, width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255]) })),
        frame: (images: number) => listener.frame({ sequence: images, images }),
        end: () => listener?.ended(),
      }
      this.sources.push(source); f.sources.push(source)
      return source
    })
    private readonly closing = new Set<() => void>()
    private closed = false
    onClose(listener: () => void) {
      this.closing.add(listener)
      return () => this.closing.delete(listener)
    }
    close = vi.fn(() => {
      if (this.closed) return
      this.closed = true
      for (const source of this.sources) source.end()
      for (const listener of this.closing) listener()
      this.closing.clear()
    })
    constructor(public stream: unknown) {
      f.connections.push(this)
    }
  },
  TerminalView: class {
    element = document.createElement('div')
    dispose = vi.fn(() => this.element.remove())
    focus = vi.fn()
    unmount = vi.fn(() => this.element.remove())
    mount = vi.fn((host: HTMLElement) => {
      host.append(this.element)
      this.options.onFit({
        columns: 80,
        rows: 24,
        cellWidth: 8,
        cellHeight: 16,
      })
    })
    constructor(
      public source: unknown,
      public options: {
        onFit: (size: {
          columns: number
          rows: number
          cellWidth: number
          cellHeight: number
        }) => void
      }
    ) {
      f.views.push(this)
    }
  },
}))
import { Modifier } from '@apackdev/terminal-view'
import { mountNativeTerminal, observeNativeTerminalImage } from '#extensions/terminal/pool.ts'
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})
const root = () => {
  const element = document.createElement('div')
  document.body.append(element)
  return element
}
it('retains the broker drawing across mounts and refuses an old host release', () => {
  const firstHost = root(),
    secondHost = root(),
    size = vi.fn(),
    session = { id: 'broker-main', target: null }
  const first = mountNativeTerminal('main', session, firstHost, size),
    view = f.views.at(-1)!
  const second = mountNativeTerminal('main', { ...session }, secondHost, size)
  expect(f.views.at(-1)).toBe(view)
  expect(view.options.theme).toMatchObject({
    background: 0x191919,
    foreground: 0xd4d0ca,
    cursor: 0xd3aa8e,
    cursorText: 0x191919,
  })
  expect(firstHost.children).toHaveLength(0)
  expect(secondHost.children).toHaveLength(1)
  first.detach()
  first.focus()
  expect(secondHost.children).toHaveLength(1)
  expect(view.focus).not.toHaveBeenCalled()
  second.focus()
  expect(view.focus).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(100)
  expect(size).toHaveBeenCalledExactlyOnceWith({
    columns: 80,
    rows: 24,
    cell: { width: 8, height: 16 },
  })
  expect(view.source.id).toBe('broker-main')
  expect(first).not.toHaveProperty('write')
  second.detach()
})
it('coalesces measured resize and discards a detached host’s queued size', () => {
  const size = vi.fn(),
    mount = mountNativeTerminal(
      'size',
      { id: 'broker-size', target: null },
      root(),
      size
    ),
    view = f.views.at(-1)!
  view.options.onFit({ columns: 100, rows: 30, cellWidth: 9, cellHeight: 18 })
  view.options.onFit({ columns: 101, rows: 31, cellWidth: 9, cellHeight: 18 })
  vi.advanceTimersByTime(100)
  expect(size).toHaveBeenCalledExactlyOnceWith({
    columns: 101,
    rows: 31,
    cell: { width: 9, height: 18 },
  })
  view.options.onFit({ columns: 101, rows: 31, cellWidth: 9, cellHeight: 18 })
  vi.advanceTimersByTime(100)
  expect(size).toHaveBeenCalledTimes(1)
  view.options.onFit({ columns: 110, rows: 40, cellWidth: 9, cellHeight: 18 })
  mount.detach()
  vi.advanceTimersByTime(100)
  expect(size).toHaveBeenCalledTimes(1)
})
it('replaces a changed broker session without retaining the old screen or host authority', () => {
  const first = mountNativeTerminal(
      'replace',
      { id: 'broker-old', target: null },
      root(),
      vi.fn()
    ),
    old = f.views.at(-1)!
  const next = mountNativeTerminal(
    'replace',
    { id: 'broker-new', target: null },
    root(),
    vi.fn()
  )
  expect(old.dispose).toHaveBeenCalledOnce()
  expect(f.views.at(-1)!.source.id).toBe('broker-new')
  first.focus()
  expect(old.focus).not.toHaveBeenCalled()
  first.detach()
  next.detach()
})
it('shares a target connection and reconnects on an explicit mount after that stream closes', () => {
  const one = mountNativeTerminal(
      'connection-a',
      { id: 'a', target: 'remote-fixture' },
      root(),
      vi.fn()
    ),
    broker = f.connections.at(-1)!,
    stream = f.streams.at(-1)!
  const two = mountNativeTerminal(
    'connection-b',
    { id: 'b', target: 'remote-fixture' },
    root(),
    vi.fn()
  )
  expect(f.connections.at(-1)).toBe(broker)
  stream.drop()
  const again = mountNativeTerminal(
    'connection-a',
    { id: 'a', target: 'remote-fixture' },
    root(),
    vi.fn()
  )
  expect(f.connections.at(-1)).not.toBe(broker)
  one.detach()
  two.detach()
  again.detach()
})

it('keeps transition input gated, permits cancellation and retires detached input authority', async () => {
  const mounted = mountNativeTerminal(
      'input-gate',
      { id: 'broker-gate', target: null },
      root(),
      vi.fn()
    ),
    view = f.views.at(-1)!,
    raw = f.connections
      .flatMap((connection) =>
        connection.open.mock.results.map((result: any) => result.value)
      )
      .find((source) => source?.id === 'broker-gate')
  mounted.setInputBlocked(true)
  view.source.text('stale')
  view.source.pointer({})
  await expect(view.source.paste('stale')).rejects.toThrow('changing')
  view.source.key({ code: 'Enter', modifiers: 0 })
  expect(raw.key).not.toHaveBeenCalled()
  expect(raw.text).not.toHaveBeenCalled()
  expect(raw.pointer).not.toHaveBeenCalled()
  view.source.key({ code: 'KeyC', modifiers: Modifier.control })
  expect(raw.key).toHaveBeenCalledOnce()
  mounted.setInputBlocked(false)
  view.source.text('current')
  expect(raw.text).toHaveBeenCalledExactlyOnceWith('current')
  mounted.detach()
  view.source.text('retired')
  view.source.key({ code: 'KeyC', modifiers: Modifier.control })
  expect(raw.text).toHaveBeenCalledTimes(1)
  expect(raw.key).toHaveBeenCalledTimes(1)
})

it('releases reported focus before retiring the Claude terminal drawing', () => {
  const mounted = mountNativeTerminal('focus-owner', { id: 'focus-session', target: null }, root(), vi.fn())
  const view = f.views.at(-1)!
  const raw = f.sources.at(-1)!

  view.source.focus(true)
  mounted.setInputBlocked(true)
  view.unmount.mockImplementationOnce(() => view.source.focus(false))
  mounted.detach()
  expect(raw.focus.mock.calls).toEqual([[true], [false]])

  view.source.focus(true)
  view.source.focus(false)
  expect(raw.focus.mock.calls).toEqual([[true], [false]])
})

it('recovers mounted drawings once on a previously working shared connection and retires old input', () => {
  const hostA = root(),
    hostB = root(),
    size = vi.fn()
  const first = mountNativeTerminal(
    'recover-a',
    { id: 'recover-a', target: 'recovery-target' },
    hostA,
    size,
    true
  )
  const oldA = f.views.at(-1)!
  const second = mountNativeTerminal(
    'recover-b',
    { id: 'recover-b', target: 'recovery-target' },
    hostB,
    size
  )
  const oldB = f.views.at(-1)!,
    stream = f.streams.at(-1)!,
    count = f.connections.length
  stream.answer()
  stream.drop()
  expect(f.connections.length).toBe(count + 1)
  const nextA = f.views.at(-2)!,
    nextB = f.views.at(-1)!
  expect(hostA.firstElementChild?.firstElementChild).toBe(nextA.element)
  expect(hostB.firstElementChild?.firstElementChild).toBe(nextB.element)
  expect(oldA.dispose).toHaveBeenCalledOnce()
  expect(oldB.dispose).toHaveBeenCalledOnce()
  const raw = f.connections.at(-1)!.open.mock.results[0].value
  oldA.source.text('retired')
  oldA.source.key({ code: 'KeyC', modifiers: Modifier.control })
  expect(
    f.connections.at(-2)!.open.mock.results[0].value.text
  ).not.toHaveBeenCalled()
  expect(
    f.connections.at(-2)!.open.mock.results[0].value.key
  ).not.toHaveBeenCalled()
  nextA.source.text('gated')
  expect(raw.text).not.toHaveBeenCalled()
  first.setInputBlocked(false)
  nextA.source.text('current')
  expect(raw.text).toHaveBeenCalledExactlyOnceWith('current')
  first.focus()
  expect(nextA.focus).toHaveBeenCalledOnce()
  expect(oldA.focus).not.toHaveBeenCalled()
  const retried = f.streams.at(-1)!
  retried.answer()
  retried.drop()
  expect(f.connections.length).toBe(count + 1)
  nextA.source.text('disconnected')
  expect(raw.text).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1000)
  expect(f.connections.length).toBe(count + 1)
  first.detach()
  second.detach()
})
it('does not reconnect an unanswered connection or a detached drawing', () => {
  const unanswered = mountNativeTerminal(
    'unanswered',
    { id: 'unanswered', target: 'unanswered-target' },
    root(),
    vi.fn()
  )
  const count = f.connections.length
  f.streams.at(-1)!.drop()
  expect(f.connections.length).toBe(count)
  unanswered.detach()
  const detached = mountNativeTerminal(
    'detached-loss',
    { id: 'detached-loss', target: 'detached-target' },
    root(),
    vi.fn()
  )
  const stream = f.streams.at(-1)!,
    before = f.connections.length
  detached.detach()
  stream.answer()
  stream.drop()
  expect(f.connections.length).toBe(before)
})

it('shares one read-only image channel per owner and releases it after its last image', async () => {
  const session = { id: 'image-session', target: 'image-host' }, changed = vi.fn()
  const drawing = mountNativeTerminal('image-owner', session, root(), vi.fn())
  const count = f.connections.length, views = f.views.length
  const stop = observeNativeTerminalImage(session, 7, changed), connection = f.connections.at(-1), source = f.sources.at(-1)
  const secondChanged = vi.fn(), stopSecond = observeNativeTerminalImage(session, 8, secondChanged)
  expect(f.connections.length).toBe(count + 1); expect(f.views.length).toBe(views)
  expect(connection.open).toHaveBeenCalledExactlyOnceWith('image-session')
  source.frame(1); await Promise.resolve()
  expect(source.image.mock.calls).toEqual([[7], [8]])
  expect(source.acknowledge).toHaveBeenCalledExactlyOnceWith(1)
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 1 }))
  expect(secondChanged).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 1 }))
  expect(source.key).not.toHaveBeenCalled(); expect(source.text).not.toHaveBeenCalled(); expect(source.pointer).not.toHaveBeenCalled()
  stop(); expect(connection.close).not.toHaveBeenCalled()
  stopSecond(); expect(connection.close).toHaveBeenCalled()
  drawing.detach()
})
it('reconnects an image observer once after a working connection fails, then clears on a second failure', async () => {
  const changed = vi.fn(), stop = observeNativeTerminalImage({ id: 'reconnect-image', target: 'image-reconnect-host' }, 9, changed)
  const first = f.streams.at(-1); first.answer(); f.sources.at(-1).frame(1); await Promise.resolve()
  const count = f.connections.length; first.drop()
  expect(changed).toHaveBeenLastCalledWith(null); expect(f.connections.length).toBe(count + 1)
  expect(f.connections.at(-1).open).toHaveBeenCalledWith('reconnect-image')
  const second = f.streams.at(-1); second.answer(); f.sources.at(-1).frame(2); await Promise.resolve()
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ generation: 1 }))
  second.drop(); expect(changed).toHaveBeenLastCalledWith(null); expect(f.connections.length).toBe(count + 1)
  stop()
})
