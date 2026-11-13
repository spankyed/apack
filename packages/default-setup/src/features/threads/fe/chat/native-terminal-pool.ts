import {
  BrokerViews,
  TerminalView,
  xtermPalette,
  Modifier,
  type TerminalSource,
  type KeyInput
} from 'apack-terminal-view'
import { CLAUDE_NATIVE_TERMINAL_COLORS } from '#features/code/be/terminal-colors.ts'
import { terminalViews } from '@apackdev/sdk/fe'
import type {
  ClaudeNativeTerminalSession,
  ClaudeNativeTerminalSize
} from '#features/code/common/native-terminal.ts'

type Connection = { views: BrokerViews; closed: boolean }
type Entry = {
  session: ClaudeNativeTerminalSession
  connection: Connection
  view: TerminalView
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
  palette: xtermPalette(
    CLAUDE_NATIVE_TERMINAL_COLORS.ansi.map(rgb)
  ),
  cursor: rgb(CLAUDE_NATIVE_TERMINAL_COLORS.cursor),
  cursorText: rgb(CLAUDE_NATIVE_TERMINAL_COLORS.background),
  selectionBackground: 0x51443a,
  selectionForeground: null,
  minimumContrast: 7
}
function connection(target: string | null): Connection {
  const key = target ?? '',
    existing = connections.get(key)
  if (existing && !existing.closed) return existing
  const stream = terminalViews(target ?? undefined),
    current = { views: new BrokerViews(stream), closed: false }
  connections.set(key, current)
  const closed = () => {
    current.closed = true
    if (connections.get(key) === current) connections.delete(key)
  }
  stream.onClose(closed)
  current.views.onClose(closed)
  return current
}
function dispose(entry: Entry) {
  entry.lease = undefined
  entry.resize = undefined
  clearTimeout(entry.timer)
  entry.view.dispose()
}
/** Preserve the native transition gate while the broker remains the only key encoder. */
function ownedInput(source: TerminalSource, entry: Entry): TerminalSource {
  const kept = new Map<PropertyKey, unknown>(),
    allowed = () => !!entry.lease && !entry.inputBlocked
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
            (entry.lease &&
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
    }
  })
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
      view: undefined!
    }
    created.view = new TerminalView(
      ownedInput(broker.views.open(session.id), created),
      {
        font: { family: 'Menlo, Monaco, monospace', size: 13 },
        theme,
        onFit: (fit) => {
          created.view.element.dataset.nativeTerminalColumns = String(
            Math.max(2, Math.min(500, fit.columns))
          )
          created.view.element.dataset.nativeTerminalRows = String(
            Math.max(2, Math.min(200, fit.rows))
          )
          created.size = {
            columns: Math.max(2, Math.min(500, fit.columns)),
            rows: Math.max(2, Math.min(200, fit.rows)),
            cell: { width: fit.cellWidth, height: fit.cellHeight }
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
          )
      }
    )
    created.view.element.dataset.nativeTerminal = ''
    entry = created
    entries.set(ownerId, entry)
  }
  const target = entry,
    lease = {}
  target.lease = lease
  target.inputBlocked = inputBlocked
  target.resize = resize
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
      target.resize = undefined
      clearTimeout(target.timer)
      target.view.unmount()
    }
  }
}
