/**
 * How far behind a window may fall before the program writing is made to wait.
 *
 * **Counted in characters sent and not yet drawn**, per window. Sixteen of the host's largest messages: a
 * window parses that in tens of milliseconds, so a program is paused only when a window has genuinely
 * stopped keeping up, and what the app holds for a stalled window is bounded by this rather than by how
 * long the stall lasts.
 */
export const OUTPUT_HIGH_WATER = 1_048_576

/**
 * How far a window must catch up before the program is read again.
 *
 * Well below the high mark, so a session at the edge does not pause and resume on every message, and above
 * `OUTPUT_ACK_EVERY`, or a window that had acknowledged everything it could would never be seen to have
 * caught up.
 */
export const OUTPUT_LOW_WATER = 131_072

/** How many characters a window takes before it says how far it has got */
export const OUTPUT_ACK_EVERY = 32_768

/**
 * One terminal's output, measured against how far each window has drawn it.
 *
 * **Why this exists.** The host bounds what is in flight to this process, and nothing bounded what this
 * process then sent on: output is broadcast to every window, and a window that draws slower than a program
 * writes had its backlog held here, growing for as long as the program ran. This says when a window is too
 * far behind, so the session can be paused — which stops the pty being read, so the program blocks on its
 * own write — and when it has caught up.
 *
 * **Positions, not amounts.** Each message carries where the stream stands after it, and a window answers
 * with the last position it drew. An amount ("I drew 32,768 more") is wrong for good the first time one is
 * lost — a window reloading its frontend forgets what it had counted — where a position is corrected by
 * the next one sent.
 *
 * **A window counts once it has answered.** Output goes to every window, and one that is not drawing a
 * terminal still answers for it, having nothing to fall behind on. A window that has never answered is not
 * waited for: it may not be there to answer.
 */
export class OutputFlow {
  private sent = 0
  private readonly drawn = new Map<string, number>()
  private held = false

  /** Where the stream stands after `chars` more, and whether the session should now be paused */
  send(chars: number): { position: number; pause: boolean } {
    this.sent += chars
    return { position: this.sent, pause: this.hold() }
  }

  /** A window has drawn up to `position`. Answers whether the session should now be read again */
  drew(client: string, position: number): { resume: boolean } {
    // Never past what was sent: a position from before this process restarted names a stream that is gone
    this.drawn.set(client, Math.min(Math.max(position, 0), this.sent))
    return { resume: this.release() }
  }

  /** A window has gone, so nothing waits for it. Answers whether the session should now be read again */
  forget(client: string): { resume: boolean } {
    this.drawn.delete(client)
    return { resume: this.release() }
  }

  /** A new shell is running in this terminal, and a new session is never paused */
  restarted(): void {
    this.held = false
  }

  /** The furthest any window that answers is behind */
  private behind(): number {
    let most = 0
    for (const position of this.drawn.values()) most = Math.max(most, this.sent - position)
    return most
  }

  private hold(): boolean {
    if (this.held || this.behind() <= OUTPUT_HIGH_WATER) return false
    this.held = true
    return true
  }

  private release(): boolean {
    if (!this.held || this.behind() > OUTPUT_LOW_WATER) return false
    this.held = false
    return true
  }
}
