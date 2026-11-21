// What happens when code that is not the kernel's throws. A state's work that fails goes where the state says. A
// handler that throws changes nothing. And none of it stops the kernel, which goes on taking what comes next.
//
//   npx tsx docs/plans/apack-spec/prototype/failure-check.mts
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { given, reaching, system } from './state.mts'

type SlowAsks = { WAIT: { args: { turns: number }; answer: string } }
type App = { systems: { slow: { events: never; asks: SlowAsks } }; surfaces: {}; views: {} }
const state = reaching<App>()

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

const slow = state<{}, never, SlowAsks>()({
  asks: { WAIT: async ({ turns: count }) => { await turns(count); return 'done' } },
})

type How = 'later' | 'at once' | 'while asking' | 'in failed too' | 'not at all'
type PanelEvent =
  | { type: 'START'; how: How }
  | { type: 'SET_UP' }
  | { type: 'LEAVE' }
  | { type: 'COUNT' }
  | { type: 'BREAK' }
type Panel = {
  data: { count: number; problem: string | null }
  states: {
    idle: {}
    working: { data: { how: How } }
    /** Its work only sets things up, and so it need not say where it goes. */
    ready: {}
  }
}

const panel = (released: string[]) => state<Panel, PanelEvent>()({
  data: { count: 0, problem: null },
  start: 'idle',
  on: {
    START: ({ how }) => ({ at: 'working', data: { how, problem: null } }),
    SET_UP: () => ({ at: 'ready' }),
    LEAVE: () => ({ at: 'idle' }),
    COUNT: (_, { data }) => ({ data: { count: data.count + 1 } }),
    // Tells itself to count, and then throws.
    BREAK: (_, { send }) => { send({ type: 'COUNT' }); throw new Error('the handler broke') },
  },
  states: {
    idle: {},
    working: {
      data: { how: given },
      run({ data, ask, use }) {
        use(() => { released.push('first') })
        use(() => { throw new Error('the release broke') })
        use(() => { released.push('last') })
        if (data.how === 'at once') throw new Error('broke at once')
        return (async () => {
          if (data.how === 'while asking') await ask('slow', 'WAIT', { turns: 30 })
          await turns(4)
          if (data.how !== 'not at all') throw new Error(`broke ${data.how}`)
          return { at: 'idle' as const }
        })()
      },
      failed: (error, { data }) => {
        if (data.how === 'in failed too') throw new Error('failed broke as well')
        return { at: 'idle', data: { problem: error instanceof Error ? error.message : String(error) } }
      },
    },
    ready: {
      run() { throw new Error('could not set up') },
    },
  },
})

const wired = () => {
  const released: string[] = []
  const traced: string[] = []
  const backend = system({ side: 'backend' })
  backend.start('slow', slow)
  const window = system({ side: 'window', trace: (line) => { if (/failed|DEFECT/.test(line)) traced.push(line) } })
  window.connect(backend)
  const handle = window.start('panel', panel(released))
  const value = () => window.read(handle)
  return { released, traced, send: (event: PanelEvent): void => window.send(handle, event), at: (): string => value().at, problem: (): string | null => value().data.problem, count: (): number => value().data.count, stop: (): void => { window.stop(); backend.stop() } }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['work that fails later goes where the state says, with what it threw', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'later' })
    strictEqual(it.at(), 'working')
    await turns(10)
    strictEqual(it.at(), 'idle')
    strictEqual(it.problem(), 'broke later')
    it.stop()
  }],
  ['work that fails at once goes there too, in the step that entered it', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'at once' })
    strictEqual(it.at(), 'idle')
    strictEqual(it.problem(), 'broke at once')
    it.stop()
  }],
  ['work that succeeds never reaches `failed`', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'not at all' })
    await turns(10)
    strictEqual(it.at(), 'idle')
    strictEqual(it.problem(), null)
    deepStrictEqual(it.traced.filter((line) => !line.includes('release')), [])
    it.stop()
  }],
  ['a state left while it was asking has not failed: `failed` is not called', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'while asking' })
    await turns(6)
    it.send({ type: 'LEAVE' })
    await turns(10)
    strictEqual(it.at(), 'idle')
    strictEqual(it.problem(), null)
    deepStrictEqual(it.traced.filter((line) => line.includes('failed')), [])
    it.stop()
  }],
  ['work that fails after its state was left changes nothing, and is reported', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'later' })
    it.send({ type: 'LEAVE' })
    await turns(10)
    strictEqual(it.problem(), null)
    ok(it.traced.some((line) => line.includes('failed after it was left: broke later')))
    it.stop()
  }],
  ['a handler that throws changes nothing, and the next event is handled', async () => {
    const it = wired()
    it.send({ type: 'COUNT' })
    it.send({ type: 'BREAK' })
    strictEqual(it.at(), 'idle')
    ok(it.traced.some((line) => line.includes('threw handling BREAK')))
    it.send({ type: 'COUNT' })
    // Two counts of its own and the one the broken handler sent before it threw: what was sent is sent.
    strictEqual(it.count(), 3)
    it.stop()
  }],
  ['a `failed` that throws is reported, and the state takes events as before', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'in failed too' })
    await turns(10)
    strictEqual(it.at(), 'working')
    ok(it.traced.some((line) => line.includes("failed threw: failed broke as well")))
    it.send({ type: 'LEAVE' })
    strictEqual(it.at(), 'idle')
    it.stop()
  }],
  ['work that only sets up may say nowhere to go: what it throws is reported and the state stays', async () => {
    const it = wired()
    it.send({ type: 'SET_UP' })
    strictEqual(it.at(), 'ready')
    ok(it.traced.some((line) => line.includes('panel in ready failed: could not set up')))
    it.send({ type: 'LEAVE' })
    strictEqual(it.at(), 'idle')
    it.stop()
  }],
  ['a release that throws does not keep the others from running', async () => {
    const it = wired()
    it.send({ type: 'START', how: 'not at all' })
    it.send({ type: 'LEAVE' })
    deepStrictEqual(it.released, ['last', 'first'])
    ok(it.traced.some((line) => line.includes('the release broke')))
    it.stop()
  }],
]

// Work that awaits has to say where the state goes if it fails. Work that does not, need not.
state<Panel, PanelEvent>()({
  data: { count: 0, problem: null },
  start: 'idle',
  states: {
    idle: {},
    // @ts-expect-error its work awaits, and it does not say where it goes when that fails
    working: { data: { how: given }, async run() { await turns(1) } },
    ready: { run() {} },
  },
})

const unhandled: unknown[] = []
process.on('unhandledRejection', (reason) => { unhandled.push(reason) })

let failed = 0
for (const [name, check] of checks) {
  try { await check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 6).join(' ')}`) }
}
await turns(60)
if (unhandled.length) { failed++; console.log(`  FAIL  nothing was left unhandled\n        ${String(unhandled[0])}`) } else console.log('  ok    none of it left a rejection unhandled')
console.log(`\n${checks.length + 1 - failed} of ${checks.length + 1} passed`)
if (failed) process.exitCode = 1
