// What a long-lived child's stderr costs to keep.
//
// A streaming agent child runs for as long as the conversation does, and every chunk it wrote to stderr was
// retained in an array. It is kept for one reason — a post-mortem when the child exits badly — and the
// useful part of that is the end, so the tail is bounded and what falls off is counted rather than hidden.
import { describe, expect, it } from 'vitest'
import { createStderrTail } from '#features/code/be/services/claude-code/stderr-tail.ts'

describe('a long-lived child\'s stderr', () => {
  it('keeps everything that fits, and says nothing was lost', () => {
    const tail = createStderrTail(64)
    tail.append(Buffer.from('a warning\n'))

    expect(tail.text()).toBe('a warning\n')
    expect(tail.discardedBytes).toBe(0)
    expect(tail.retainedBytes).toBe(10)
  })

  /** The bound is the whole point: a CLI in a retry loop writes for the life of the turn. */
  it('holds the tail to the limit however much is written', () => {
    const tail = createStderrTail(16)
    for (let i = 0; i < 100; i++) tail.append(Buffer.from('0123456789'))

    expect(tail.retainedBytes).toBe(16)
    expect(tail.discardedBytes).toBe(1000 - 16)
    expect(tail.text()).toContain('984 bytes discarded')
  })

  /** One chunk can be larger than the limit on its own — a stack trace, a dumped buffer. */
  it('keeps the end of a chunk bigger than the whole limit', () => {
    const tail = createStderrTail(8)
    tail.append(Buffer.from('aaaaaaaaaaaaBCDEFGHI'))

    expect(tail.retainedBytes).toBe(8)
    expect(tail.text().endsWith('BCDEFGHI')).toBe(true)
  })

  /**
   * **A byte cut lands mid-character**, and the first bytes of the tail are then continuation bytes with no
   * lead — which decode to replacement characters and make the log look corrupt rather than truncated. Only
   * those are dropped; an incomplete character at the *end* is kept, because the next append completes it.
   */
  it('drops a partial character at the cut rather than rendering mojibake', () => {
    const tail = createStderrTail(5)
    // Four three-byte characters: the cut cannot land on a boundary
    tail.append(Buffer.from('日本語だ', 'utf8'))

    const text = tail.text()
    expect(text).not.toContain('�')
    expect(text.endsWith('だ')).toBe(true)
  })

  it('completes a character split across two appends', () => {
    const tail = createStderrTail(64)
    const bytes = Buffer.from('語', 'utf8')
    tail.append(bytes.subarray(0, 1))
    tail.append(bytes.subarray(1))

    expect(tail.text()).toBe('語')
  })

  it('refuses a limit that is not a size', () => {
    expect(() => createStderrTail(0)).toThrow(RangeError)
    expect(() => createStderrTail(-1)).toThrow(RangeError)
    expect(() => createStderrTail(1.5)).toThrow(RangeError)
  })
})
