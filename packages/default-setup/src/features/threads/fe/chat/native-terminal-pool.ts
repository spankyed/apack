import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
interface NativeTerminalEntry {
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
  sequence: number
  replaying: boolean
  input?: (text: string) => void
}
const entries = new Map<string, NativeTerminalEntry>()
/** Retain the emulator across view changes; never forward terminal replies synthesized by history replay. */
export function mountNativeTerminal(ownerId: string, container: HTMLElement, input: (text: string) => void) {
  let entry = entries.get(ownerId)
  if (!entry) {
    for (const [id, old] of entries) {
      if (entries.size < 16) break
      if (!old.element.isConnected) { old.term.dispose(); entries.delete(id) }
    }
    const element = document.createElement('div'); element.className = 'h-full w-full'
    const term = new Terminal({ fontSize: 13, fontFamily: 'Menlo, Monaco, monospace', lineHeight: 1.15, cursorBlink: true, scrollback: 5000,
      allowProposedApi: false, theme: { background: '#191919', foreground: '#d4d0ca', cursor: '#d3aa8e', selectionBackground: '#b68e7340' } })
    const fit = new FitAddon(); term.loadAddon(fit)
    entry = { term, fit, element, sequence: 0, replaying: false }
    entries.set(ownerId, entry); container.append(element); term.open(element)
    const target = entry
    term.onData(text => { if (!target.replaying) target.input?.(text) })
  } else container.append(entry.element)
  entry.input = input
  const target = entry
  return {
    fit() { target.fit.fit(); return { columns: target.term.cols, rows: target.term.rows } },
    write(chunks: readonly { sequence: number; text: string }[]) {
      const fresh = chunks.filter(chunk => chunk.sequence > target.sequence)
      if (!fresh.length) return
      const replay = target.sequence === 0 || fresh[0]!.sequence > target.sequence + 1
      if (replay) { target.replaying = true; target.term.reset() }
      target.sequence = fresh.at(-1)!.sequence
      target.term.write(fresh.map(chunk => chunk.text).join(''), () => { if (replay) target.replaying = false })
    },
    focus() { target.term.focus() },
    detach() { if (target.input === input) { target.input = undefined; target.element.remove() } },
  }
}
