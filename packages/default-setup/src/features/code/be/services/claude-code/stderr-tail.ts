/** Byte-bounded diagnostic retention for a long-lived child. */
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
