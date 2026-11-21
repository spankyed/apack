// What a frame is in a window, for the kernel's `frame` option: the next paint while the window is showing, and the
// next turn of the event loop while it is not.
//
// A browser gives a hidden window no frames. Progress gathered for the next one would then wait until the window is
// shown again, growing all the while. A hidden window paints nothing, so it has no reason to wait for a paint: it
// takes what was gathered on the next turn, the way the backend does. And what was already waiting for a frame when
// the window was hidden is handed over then, since that frame is not coming.

export interface WindowFrames {
  /** Whether the window is hidden now: `document.hidden` */
  hidden(): boolean
  /** Runs something before the next paint: `requestAnimationFrame` */
  frame(run: () => void): void
  /** Runs something on the next turn of the event loop */
  later(run: () => void): void
  /** Calls the listener each time the window becomes hidden: `visibilitychange`, when `document.hidden` */
  onHidden(listener: () => void): void
}

export function windowFrame(env: WindowFrames): (run: () => void) => void {
  /** What is waiting to run. Each runs once, whichever of the frame and the turn reaches it first. */
  const waiting = new Set<() => void>()
  env.onHidden(() => { for (const once of [...waiting]) env.later(once) })

  return (run) => {
    const once = (): void => { if (waiting.delete(once)) run() }
    waiting.add(once)
    if (env.hidden()) env.later(once); else env.frame(once)
  }
}
