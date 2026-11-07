// The terminal's output fan-out keeps no copy, which is F3 and F6.
//
// It used to hold every terminal's whole output as a string, concatenated on each chunk — quadratic in the
// output's length, on the renderer's main thread — and persist it to window storage on a debounce, up to a
// megabyte per terminal per burst. Both were copies of a scrollback the emulator already holds. The goal
// that removed them says to delete rather than repair, so these cases fail if either comes back.
import { beforeEach, describe, expect, it } from 'vitest'
import { terminalEventBus } from '#features/code/fe/utils/terminal-events.ts'

/** A burst big enough that keeping it would be obvious: 1 MiB in 4 KiB chunks */
const CHUNK = 'x'.repeat(4096)
const CHUNKS = 256

/** Every name in this window's storage, read the way a page reads it */
const stored = () => Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at))

beforeEach(() => {
  localStorage.clear()
  terminalEventBus.clearAll()
})

describe('the terminal output bus', () => {
  it('writes nothing to window storage, however much output passes through it', () => {
    const seen: string[] = []
    terminalEventBus.subscribe('t-1', (_id, data) => seen.push(data))

    for (let chunk = 0; chunk < CHUNKS; chunk++) terminalEventBus.emit('t-1', CHUNK)

    expect(seen).toHaveLength(CHUNKS)
    // F6: a megabyte per terminal per burst, written synchronously, is what this refuses
    // Through the Storage API, not `Object.keys`: the harness's stand-in is a plain object, so its own
    // keys are its methods
    expect(stored(), 'the bus persisted something').toEqual([])
  })

  it('exposes no accumulated output to read back, so nothing can hold one', () => {
    // F3: the accumulation was reachable as `getOutput`, which is what a replay used. Its absence is the
    // fix — a cheaper buffer here would still be a copy nothing needs
    expect('getOutput' in terminalEventBus).toBe(false)
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(terminalEventBus)))
      .toEqual(['constructor', 'subscribe', 'emit', 'clearOutput', 'clearAll'])
  })

  it('hands each subscriber the chunk and forgets it', () => {
    const first: string[] = []
    const second: string[] = []
    const stop = terminalEventBus.subscribe('t-1', (_id, data) => first.push(data))
    terminalEventBus.subscribe('t-1', (_id, data) => second.push(data))

    terminalEventBus.emit('t-1', 'one')
    stop()
    terminalEventBus.emit('t-1', 'two')

    expect(first).toEqual(['one'])
    expect(second).toEqual(['one', 'two'])
  })

  it('delivers to the terminal that produced it and to no other', () => {
    const mine: string[] = []
    terminalEventBus.subscribe('t-1', (_id, data) => mine.push(data))
    terminalEventBus.emit('t-2', 'not mine')
    expect(mine).toEqual([])
  })
})
