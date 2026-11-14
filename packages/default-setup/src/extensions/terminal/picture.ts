/** Pixels already decoded by the broker, never filesystem names or terminal escape sequences. */
export interface TerminalPicture {
  readonly generation: number
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
}

export interface TerminalPictureSource {
  attach(listener: { frame(frame: { sequence: number; images: number }): void; ended(reason?: string): void }): () => void
  acknowledge(sequence: number): void
  image(id: number): Promise<TerminalPicture | null>
}

/** Read-only image subscription. Coalesce changes and refuse replies from superseded frames/attachments. */
export function observeTerminalPicture(source: TerminalPictureSource, id: number, changed: (picture: TerminalPicture | null) => void): () => void {
  let active = true, revision = 0, counter: number | undefined, pending = false
  async function refresh() {
    if (pending || !active) return
    pending = true
    try {
      let requested: number
      do {
        requested = revision
        let picture: TerminalPicture | null = null
        try { picture = await source.image(id) } catch { /* An ended/replaced source has no pixels. */ }
        if (active && revision === requested) changed(picture)
      } while (active && revision !== requested)
    } finally { pending = false }
  }
  const detach = source.attach({
    frame(frame) {
      source.acknowledge(frame.sequence)
      if (!active || frame.images === counter) return
      counter = frame.images
      revision++
      changed(null)
      void refresh()
    },
    ended() { active = false; revision++; changed(null) },
  })
  return () => { active = false; revision++; detach() }
}
