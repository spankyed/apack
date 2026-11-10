// How far a window may fall behind a terminal's output before the program is made to wait.
//
// Output is broadcast to every window, and a window that draws slower than a program writes had its backlog
// held by the app for as long as the program ran. `OutputFlow` is the arithmetic that says when to pause the
// session and when to read it again; these drive it without a session.
import { describe, expect, it } from 'vitest'
import { OUTPUT_ACK_EVERY, OUTPUT_HIGH_WATER, OUTPUT_LOW_WATER, OutputFlow } from '#features/code/be/services/terminal-flow.ts'

describe('how far a window may fall behind', () => {
  it('pauses once a window that answers is past the high mark, and only once', () => {
    const flow = new OutputFlow()
    flow.drew('window', flow.send(1).position)

    expect(flow.send(OUTPUT_HIGH_WATER).pause, 'at the mark is not past it').toBe(false)
    expect(flow.send(1).pause, 'a window past the mark did not pause the session').toBe(true)
    expect(flow.send(1_000).pause, 'a session already paused was paused again').toBe(false)
  })

  it('reads again when the window has caught up to the low mark, and not before', () => {
    const flow = new OutputFlow()
    flow.drew('window', flow.send(1).position)
    const { position } = flow.send(OUTPUT_HIGH_WATER + 1)

    expect(flow.drew('window', position - OUTPUT_LOW_WATER - 1).resume, 'resumed while still behind').toBe(false)
    expect(flow.drew('window', position - OUTPUT_LOW_WATER).resume, 'caught up and stayed paused').toBe(true)
    expect(flow.drew('window', position).resume, 'a session being read was resumed again').toBe(false)
  })

  it('waits for the slowest of the windows that answer', () => {
    const flow = new OutputFlow()
    const start = flow.send(1).position
    flow.drew('fast', start)
    flow.drew('slow', start)
    const { position, pause } = flow.send(OUTPUT_HIGH_WATER + 1)
    expect(pause).toBe(true)

    expect(flow.drew('fast', position).resume, 'one window catching up resumed for both').toBe(false)
    expect(flow.drew('slow', position).resume).toBe(true)
  })

  it('does not wait for a window that has never answered', () => {
    const flow = new OutputFlow()
    expect(flow.send(OUTPUT_HIGH_WATER * 4).pause, 'paused with nobody to wait for').toBe(false)
  })

  it('stops waiting for a window that has gone', () => {
    const flow = new OutputFlow()
    flow.drew('window', flow.send(1).position)
    flow.send(OUTPUT_HIGH_WATER + 1)

    expect(flow.forget('window').resume, 'a session stayed paused for a window that left').toBe(true)
  })

  it('takes a position from before a restart as nothing drawn rather than everything', () => {
    const flow = new OutputFlow()
    // A window answering with a position far past anything this stream has sent
    flow.drew('window', 9_999_999)
    expect(flow.send(OUTPUT_HIGH_WATER + 1).pause, 'a stale position hid how far behind the window was').toBe(true)
  })

  it('is not left paused by a new shell', () => {
    const flow = new OutputFlow()
    flow.drew('window', flow.send(1).position)
    flow.send(OUTPUT_HIGH_WATER + 1)
    flow.restarted()

    // The new session is being read, so falling behind again has to pause again
    expect(flow.send(1).pause).toBe(true)
  })

  it('has its marks in the order that lets a paused session resume', () => {
    // A window answers every OUTPUT_ACK_EVERY, so at rest it is up to that far behind. Were that more than
    // the low mark, a window that had answered all it could would never be seen to have caught up
    expect(OUTPUT_ACK_EVERY).toBeLessThan(OUTPUT_LOW_WATER)
    expect(OUTPUT_LOW_WATER).toBeLessThan(OUTPUT_HIGH_WATER)
  })
})
