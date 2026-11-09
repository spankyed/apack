/**
 * Byte-bounded diagnostic retention for a long-lived child.
 *
 * **A streaming agent child runs for as long as a conversation does, and everything it writes to stderr was
 * kept.** It is collected for one purpose — a post-mortem when the child exits badly — and the useful part
 * of that is the end. A CLI in a retry loop, or one whose own tools are noisy, writes to stderr for the
 * whole life of the turn, so an array of every chunk is a leak with the lifetime of the conversation and no
 * ceiling but the machine's memory.
 *
 * So the tail is kept and the rest is counted. What the text says, it says honestly: a reader is told how
 * many bytes went missing rather than handed a quietly truncated log.
 */
export function createStderrTail(limit = 64 * 1024) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid stderr limit')
  let tail = Buffer.alloc(0)
  let discarded = 0
  return {
    append(chunk: Buffer) {
      const overflow = Math.max(0, tail.length + chunk.length - limit)
      discarded += overflow
      if (chunk.length >= limit) tail = Buffer.from(chunk.subarray(chunk.length - limit))
      else tail = Buffer.concat([tail.subarray(Math.min(overflow, tail.length)), chunk])
    },
    get retainedBytes() { return tail.length },
    get discardedBytes() { return discarded },
    text() {
      // A byte cut can leave continuation bytes at the start. Drop only those;
      // retain incomplete trailing bytes until the next append completes them.
      let start = 0
      if (discarded) while (start < tail.length && (tail[start]! & 0xc0) === 0x80) start++
      const text = tail.subarray(start).toString('utf8')
      return discarded ? `[stderr truncated: ${discarded} bytes discarded]\n${text}` : text
    },
  }
}
