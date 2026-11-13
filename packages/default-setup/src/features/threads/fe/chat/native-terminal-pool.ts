import {
  BrokerViews,
  TerminalView,
  xtermPalette,
  Modifier,
  type TerminalSource,
  type KeyInput,
} from 'apack-terminal-view'
import { CLAUDE_NATIVE_TERMINAL_COLORS } from '#features/code/be/terminal-colors.ts'
import { terminalViews, type TerminalViewStream } from '@apackdev/sdk/fe'
import type {
  ClaudeNativeTerminalSession,
  ClaudeNativeTerminalSize,
} from '#features/code/common/native-terminal.ts'

type Connection = {
  views: BrokerViews
  stream: TerminalViewStream
  closed: boolean
  heard: boolean
  retry: boolean
}
type Entry = {
  session: ClaudeNativeTerminalSession
  connection: Connection
  view: TerminalView
  drawing?: object
  container?: HTMLElement
  lease?: object
  resize?: (size: ClaudeNativeTerminalSize) => void
  size?: ClaudeNativeTerminalSize
  sent?: string
  inputBlocked?: boolean
  timer?: ReturnType<typeof setTimeout>
}
const connections = new Map<string, Connection>(),
  entries = new Map<string, Entry>()
const rgb = (color: string) => parseInt(color.slice(1), 16)
const theme = {
  background: rgb(CLAUDE_NATIVE_TERMINAL_COLORS.background),
  foreground: rgb(CLAUDE_NATIVE_TERMINAL_COLORS.foreground),
  palette: xtermPalette(CLAUDE_NATIVE_TERMINAL_COLORS.ansi.map(rgb)),
  cursor: rgb(CLAUDE_NATIVE_TERMINAL_COLORS.cursor),
  cursorText: rgb(CLAUDE_NATIVE_TERMINAL_COLORS.background),
  selectionBackground: 0x51443a,
  selectionForeground: null,
  minimumContrast: 7,
}
function connection(target: string | null, retry = true): Connection {
  const key = target ?? '',
    existing = connections.get(key)
  if (existing && !existing.closed) return existing
  const stream = terminalViews(target ?? undefined),
    current: Connection = {
      views: new BrokerViews(stream),
      stream,
      closed: false,
      heard: false,
      retry,
    }
  connections.set(key, current)
  stream.onData(() => {
    current.heard = true
  })
  const closed = () => {
    if (current.closed) return
    current.closed = true
    if (connections.get(key) !== current) return
    connections.delete(key)
    current.views.close()
    current.stream.close()
    // Match the ordinary terminal's bounded retry: only a connection that worked,
    // once. An explicit later mount permits another try; no retry timer spins.
    if (!current.heard || !current.retry) return
    for (const entry of entries.values()) {
      if (entry.connection !== current || !entry.lease || !entry.container)
        continue
      const focused = entry.view.element.contains(document.activeElement)
      clearTimeout(entry.timer)
      entry.view.dispose()
      entry.connection = connection(entry.session.target, false)
      entry.sent = undefined
      entry.view = createDrawing(entry)
      entry.view.mount(entry.container)
      if (focused) entry.view.focus()
    }
  }
  stream.onClose(closed)
  current.views.onClose(closed)
  return current
}
function dispose(entry: Entry) {
  entry.lease = undefined
  entry.drawing = undefined
  entry.container = undefined
  entry.resize = undefined
  clearTimeout(entry.timer)
  entry.view.dispose()
}
/** Preserve the native transition gate while the broker remains the only key encoder. */
function ownedInput(
  source: TerminalSource,
  entry: Entry,
  drawing: object
): TerminalSource {
  const kept = new Map<PropertyKey, unknown>(),
    allowed = () =>
      entry.drawing === drawing &&
      !entry.connection.closed &&
      !!entry.lease &&
      !entry.inputBlocked
  return new Proxy(source, {
    get(target, key) {
      if (kept.has(key)) return kept.get(key)
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      let call = value.bind(target)
      if (key === 'key')
        call = (input: KeyInput) => {
          if (
            allowed() ||
            (entry.drawing === drawing &&
              !entry.connection.closed &&
              entry.lease &&
              input.code === 'KeyC' &&
              (input.modifiers & Modifier.control) !== 0 &&
              (input.modifiers & (Modifier.alt | Modifier.super)) === 0)
          )
            value.call(target, input)
        }
      else if (key === 'paste')
        call = (...args: unknown[]) =>
          allowed()
            ? value.apply(target, args)
            : Promise.reject(new Error('Native input is changing'))
      else if (['text', 'pointer', 'focus'].includes(String(key)))
        call = (...args: unknown[]) => {
          if (allowed()) value.apply(target, args)
        }
      kept.set(key, call)
      return call
    },
  })
}
function createDrawing(created: Entry): TerminalView {
  const drawing = {}
  created.drawing = drawing
  const view = new TerminalView(
    ownedInput(
      created.connection.views.open(created.session.id),
      created,
      drawing
    ),
    {
      font: { family: 'Menlo, Monaco, monospace', size: 13 },
      theme,
      onFit: (fit) => {
        if (created.drawing !== drawing) return
        created.view.element.dataset.nativeTerminalColumns = String(
          Math.max(2, Math.min(500, fit.columns))
        )
        created.view.element.dataset.nativeTerminalRows = String(
          Math.max(2, Math.min(200, fit.rows))
        )
        created.size = {
          columns: Math.max(2, Math.min(500, fit.columns)),
          rows: Math.max(2, Math.min(200, fit.rows)),
          cell: { width: fit.cellWidth, height: fit.cellHeight },
        }
        clearTimeout(created.timer)
        const lease = created.lease
        if (lease)
          created.timer = setTimeout(() => {
            if (created.lease !== lease || !created.size) return
            const key = JSON.stringify(created.size)
            if (key !== created.sent) {
              created.sent = key
              created.resize?.(created.size)
            }
          }, 100)
      },
      onLink: (link) => {
        void window.electronAPI?.shell
          .openTerminalLink(link.target)
          .catch(() => false)
      },
      confirmPaste: async (text) =>
        window.confirm(
          'This paste may run a command. Paste it into Claude’s terminal?\n\n' +
            text
        ),
    }
  )
  view.element.dataset.nativeTerminal = ''
  return view
}
/** A retained broker drawing, not an ANSI emulator. Mounting never replays bytes into a process. */
export function mountNativeTerminal(
  ownerId: string,
  session: ClaudeNativeTerminalSession,
  container: HTMLElement,
  resize: (size: ClaudeNativeTerminalSize) => void,
  inputBlocked = false
) {
  let entry = entries.get(ownerId)
  if (
    entry &&
    (entry.session.id !== session.id ||
      entry.session.target !== session.target ||
      entry.connection.closed)
  ) {
    dispose(entry)
    entries.delete(ownerId)
    entry = undefined
  }
  if (!entry) {
    for (const [id, old] of entries) {
      if (entries.size < 16) break
      if (!old.lease) {
        dispose(old)
        entries.delete(id)
      }
    }
    const broker = connection(session.target)
    const created: Entry = {
      session: { ...session },
      connection: broker,
      view: undefined!,
    }
    created.view = createDrawing(created)
    entry = created
    entries.set(ownerId, entry)
  }
  const target = entry,
    lease = {}
  target.lease = lease
  target.inputBlocked = inputBlocked
  target.resize = resize
  target.container = container
  target.sent = undefined
  target.view.mount(container)
  return {
    focus() {
      if (target.lease === lease) target.view.focus()
    },
    setInputBlocked(blocked: boolean) {
      if (target.lease === lease) target.inputBlocked = blocked
    },
    detach() {
      if (target.lease !== lease) return
      target.lease = undefined
      target.container = undefined
      target.resize = undefined
      clearTimeout(target.timer)
      target.view.unmount()
    },
  }
}
