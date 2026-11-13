const f = vi.hoisted(() => ({
  views: [] as any[],
  connections: [] as any[],
  streams: [] as any[]
}))
vi.mock('@apackdev/sdk/fe', () => ({
  terminalViews: vi.fn((target?: string) => {
    const listeners: (() => void)[] = []
    const stream = {
      target,
      onClose: (callback: () => void) => {
        listeners.push(callback)
        return () => {}
      },
      close: () => listeners.forEach((callback) => callback())
    }
    f.streams.push(stream)
    return stream
  })
}))
vi.mock('apack-terminal-view', () => ({
  Modifier: { control: 2, alt: 4, super: 8 },
  xtermPalette: (colors: number[]) => colors,
  BrokerViews: class {
    open = vi.fn((id: string) => ({
      id,
      key: vi.fn(),
      text: vi.fn(),
      paste: vi.fn(async () => 'pasted'),
      pointer: vi.fn(),
      focus: vi.fn()
    }))
    onClose = vi.fn()
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
        cellHeight: 16
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
  }
}))
import { mountNativeTerminal } from '#features/threads/fe/chat/native-terminal-pool.ts'
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
    cell: { width: 8, height: 16 }
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
    cell: { width: 9, height: 18 }
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
  stream.close()
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
  view.source.key({ code: 'KeyC', modifiers: 2 })
  expect(raw.key).toHaveBeenCalledOnce()
  mounted.setInputBlocked(false)
  view.source.text('current')
  expect(raw.text).toHaveBeenCalledExactlyOnceWith('current')
  mounted.detach()
  view.source.text('retired')
  view.source.key({ code: 'KeyC', modifiers: 2 })
  expect(raw.text).toHaveBeenCalledTimes(1)
  expect(raw.key).toHaveBeenCalledTimes(1)
})
