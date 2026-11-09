type TerminalOutputHandler = (terminalId: string, data: string) => void

/**
 * Fan-out for a terminal's output: the system broadcasts it, this hands it to whoever is drawing.
 *
 * **It keeps no copy, and deleting the one it kept is the point.** It used to hold every terminal's whole
 * output as a string, concatenated on each chunk — which is quadratic in the output's length, on the
 * renderer's main thread (F3) — and persist it to window storage on a 500 ms debounce, up to a megabyte per
 * terminal per burst, synchronously (F6). Those were a second and third copy of a scrollback the emulator
 * already holds, and the goal that removed them says to delete rather than repair: a cheaper buffer here
 * would still be a copy nothing needs.
 *
 * **Where the scrollback lives now.** In the emulator, which the pool keeps alive across a host's teardown —
 * measured: a reattach with 256 KiB of history takes 5.55 ms and the backend sends not one message, because
 * nothing is replayed. What a *fresh* emulator shows is therefore a fresh screen, and history for that case
 * is the broker's bounded history to serve, which is where a terminal's scrollback belongs: one copy, in the
 * process that owns the session.
 */
class TerminalEventBus {
  private handlers = new Map<string, Set<TerminalOutputHandler>>()

  subscribe(terminalId: string, handler: TerminalOutputHandler) {
    let handlers = this.handlers.get(terminalId)
    if (!handlers) {
      handlers = new Set()
      this.handlers.set(terminalId, handlers)
    }
    handlers.add(handler)

    return () => {
      const live = this.handlers.get(terminalId)
      if (!live) return
      live.delete(handler)
      if (live.size === 0) this.handlers.delete(terminalId)
    }
  }

  /** Hands `data` to this terminal's subscribers, and keeps none of it */
  emit(terminalId: string, data: string) {
    const handlers = this.handlers.get(terminalId)
    if (!handlers) return
    for (const handler of handlers) handler(terminalId, data)
  }

  /** Forgets a terminal's subscribers. There is no output to forget */
  clearOutput(terminalId: string) {
    this.handlers.delete(terminalId)
  }

  clearAll() {
    this.handlers.clear()
  }
}

export const terminalEventBus = new TerminalEventBus()
