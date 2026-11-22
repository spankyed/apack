// What happens to an ask when whoever made it goes: the state that asked is left while the answer is still coming.
// The ask ends where it is awaited, with `Left`, so the code that asked unwinds the way cancelled code does everywhere.
//
//   npx tsx docs/plans/apack-state/prototype/leaving-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { rest, run, system } from './checks.mts'
import { given, Left, reaching } from './state.mts'

type SlowAsks = {
  WAIT: { args: { turns: number }; answer: string }
  /** Work that is passed `signal`, and throws what it aborted with, as `fetch` and a stream do. */
  FETCH: { args: { turns: number }; answer: string }
  RELAY: { args: { turns: number }; answer: string }
}
type App = { systems: { slow: { events: never; asks: SlowAsks } }; surfaces: {}; views: {} }
const state = reaching<App>()

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

/** What the backend did, for the checks to read. */
const backendSaw: string[] = []
const slow = state<{}, never, SlowAsks>()({
  asks: {
    WAIT: async ({ turns: count }, { signal }) => {
      signal.addEventListener('abort', () => backendSaw.push('WAIT told its asker had gone'))
      await turns(count)
      return 'done'
    },
    FETCH: async ({ turns: count }, { signal }) => {
      for (let turn = 0; turn < count; turn++) { await turns(1); signal.throwIfAborted() }
      return 'done'
    },
    // A handler that itself asks. When whoever asked it goes, the ask it made goes with them.
    RELAY: async ({ turns: count }, { ask }) => {
      try { const inner = await ask('slow', 'WAIT', { turns: count }); return inner.ok ? inner.value : 'failed' }
      finally { backendSaw.push('RELAY unwound') }
    },
  },
})

type How = 'await' | 'all' | 'floating' | 'relay' | 'fetch'
type PanelEvent = { type: 'START'; how: How } | { type: 'LEAVE' }
type Panel = { states: { idle: {}; working: { data: { how: How } } } }

const panel = (saw: string[], lock: { held: boolean }) => state<Panel, PanelEvent>()({
  start: 'idle',
  on: {
    START: ({ how }) => ({ at: 'working', data: { how } }),
    LEAVE: () => ({ at: 'idle' }),
  },
  states: {
    idle: {},
    working: {
      data: { how: given },
      async run({ data, ask }) {
        lock.held = true
        try {
          if (data.how === 'await') await ask('slow', 'WAIT', { turns: 30 })
          if (data.how === 'relay') await ask('slow', 'RELAY', { turns: 30 })
          if (data.how === 'fetch') await ask('slow', 'FETCH', { turns: 30 })
          if (data.how === 'all') await Promise.all([ask('slow', 'WAIT', { turns: 30 }), turns(2)])
          if (data.how === 'floating') { void ask('slow', 'WAIT', { turns: 30 }); await turns(40) }
          saw.push('ran on after the ask')
        } catch (error) {
          saw.push(error instanceof Left ? 'unwound with Left' : `unwound with ${String(error)}`)
          throw error
        } finally {
          lock.held = false
          saw.push('finally ran')
        }
        return { at: 'idle' }
      },
      // Given what `run` threw when it is not a `Left`. These checks only ever leave, so it is never called.
      failed: (error) => { saw.push(`failed was given ${String(error)}`); return { at: 'idle' } },
    },
  },
})

const wired = () => {
  const saw: string[] = []
  const lock = { held: false }
  const traced: string[] = []
  backendSaw.length = 0
  const backendTraced: string[] = []
  const backend = system({ side: 'backend', trace: (line) => { if (/answering/.test(line)) backendTraced.push(line) } })
  backend.start('slow', slow)
  const window = system({ side: 'window', trace: (line) => { if (/left unanswered|failed/.test(line)) traced.push(line) } })
  window.connect(backend)
  const handle = window.start('panel', panel(saw, lock))
  return { saw, lock, traced, backendTraced, send: (event: PanelEvent): void => window.send(handle, event), at: (): string => window.read(handle).at, stop: (): void => { window.stop(); backend.stop() } }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['leaving mid-ask unwinds the code that asked: `finally` runs, what it held is let go, and nothing after the ask runs', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'await' })
    await turns(6)
    strictEqual(it.lock.held, true)
    it.send({ type: 'LEAVE' })
    await turns(4)
    deepStrictEqual(it.saw, ['unwound with Left', 'finally ran'])
    strictEqual(it.lock.held, false)
    strictEqual(it.at(), 'idle')
    it.stop()
  }],
  ['the kernel says an ask was left, and does not call the unwinding a failure', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'await' })
    await turns(6)
    it.send({ type: 'LEAVE' })
    await turns(4)
    strictEqual(it.traced.length, 1)
    ok(it.traced[0]!.includes('left unanswered'))
    it.stop()
  }],
  ['an ask combined with other work ends too, and does not hang', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'all' })
    await turns(6)
    it.send({ type: 'LEAVE' })
    await turns(4)
    deepStrictEqual(it.saw, ['unwound with Left', 'finally ran'])
    it.stop()
  }],
  ['the backend is told, and a handler that was itself asking unwinds as well', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'relay' })
    await turns(8)
    it.send({ type: 'LEAVE' })
    await rest()
    ok(backendSaw.includes('RELAY unwound'))
    ok(backendSaw.includes('WAIT told its asker had gone'))
    it.stop()
  }],
  ['a handler that stops because its `signal` aborted has stopped, and is not reported as having failed', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'fetch' })
    await turns(8)
    it.send({ type: 'LEAVE' })
    await rest()
    strictEqual(it.backendTraced.length, 1)
    ok(it.backendTraced[0]!.startsWith('slow stopped answering FETCH'))
    it.stop()
  }],
  ['an ask that was started and never awaited does not take the process down', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'floating' })
    await turns(6)
    it.send({ type: 'LEAVE' })
    await rest()
    // The code went on, since nothing it awaited was the ask. What it returned came after its state was left, and was dropped.
    deepStrictEqual(it.saw, ['ran on after the ask', 'finally ran'])
    strictEqual(it.at(), 'idle')
    it.stop()
  }],
  ['an answer that arrives in time is unaffected', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'await' })
    await rest()
    deepStrictEqual(it.saw, ['ran on after the ask', 'finally ran'])
    strictEqual(it.at(), 'idle')
    it.stop()
  }],
]

// An event's handler is not given `ask`: it could only start one, with nothing around it to take a `Left`.
state<Panel, PanelEvent>()({
  start: 'idle',
  on: {
    // @ts-expect-error asking is for `run` and for an ask's handler
    START: (_, { ask }) => { void ask },
    LEAVE: () => ({ at: 'idle' }),
  },
  states: { idle: {}, working: { data: { how: given } } },
})

await run(checks)
