// Progress is gathered, and nothing else is. These checks hold the order: what a window hears, it hears in the order
// it was sent, whatever kind of message each was.
//
//   npx tsx docs/plans/apack-spec/prototype/progress-check.mts
import { deepStrictEqual, strictEqual } from 'node:assert'
import { run, system } from './checks.mts'
import { given, reaching, type State } from './state.mts'

type Step = { progress: string } | { note: string }
type StreamAsks = {
  /** Sends each step in turn: a piece of progress, or a note broadcast to every window. */
  STREAM: { args: { steps: Step[]; burst: number }; progress: string; answer: { sent: number } }
  QUICK: { args: { word: string }; answer: string }
}
type PanelEvent =
  | { type: 'GO'; steps: Step[]; burst?: number }
  | { type: 'CLICK'; what: string }
  | { type: 'NOTE'; note: string }
  | { type: 'HEARD'; pieces: string[] }
type QuickEvent =
  | { type: 'ASK_QUICK'; word: string }

type App = {
  systems: { stream: { events: never; asks: StreamAsks } }
  surfaces: { panel: { events: PanelEvent } }
  views: {}
}
const state = reaching<App>()

/** Answers at once, having sent every step. */
const stream = state<{}, never, StreamAsks>()({
  asks: {
    STREAM: ({ steps, burst }, { progress, broadcast }) => {
      for (const step of steps) { if ('progress' in step) progress(step.progress); else broadcast('panel', { type: 'NOTE', note: step.note }) }
      for (let i = 0; i < burst; i++) progress(`#${i}`)
      return { sent: steps.length + burst }
    },
    QUICK: ({ word }) => word.toUpperCase(),
  },
})

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

/** Sends its progress and then takes a long while to answer, so the progress is left waiting for a frame. */
const slowStream = state<{}, never, StreamAsks>()({
  asks: {
    STREAM: async ({ steps }, { progress }) => { for (const step of steps) if ('progress' in step) progress(step.progress); await turns(40); return { sent: steps.length } },
    QUICK: ({ word }) => word.toUpperCase(),
  },
})

/** A panel that streams while it is `streaming`, and writes down everything it hears, in the order it hears it. */
const panel = (heard: string[]) => state<{ states: { idle: {}; streaming: { data: { steps: Step[]; burst: number } } } }, PanelEvent>()({
  start: 'idle',
  on: {
    GO:    ({ steps, burst }) => ({ at: 'streaming', data: { steps, burst: burst ?? 0 } }),
    CLICK: ({ what })   => { heard.push(`click:${what}`) },
    NOTE:  ({ note })   => { heard.push(`note:${note}`) },
    HEARD: ({ pieces }) => { heard.push(`progress:${pieces.join('+')}`) },
  },
  states: {
    idle: {},
    streaming: {
      data: { steps: given, burst: given },
      async run({ data, ask, send }) {
        const done = await ask('stream', 'STREAM', { steps: data.steps, burst: data.burst }, (pieces) => send({ type: 'HEARD', pieces: [...pieces] }))
        heard.push(done.ok ? `answer:stream:${done.value.sent}` : 'answer:failed')
        return { at: 'idle' }
      },
      failed: () => ({ at: 'idle' }),
    },
  },
})

/** A second state in the same window, asking something quick of the same backend. */
const quick = (heard: string[]) => state<{ states: { idle: {}; asking: { data: { word: string } } } }, QuickEvent>()({
  start: 'idle',
  on: { ASK_QUICK: ({ word }) => ({ at: 'asking', data: { word } }) },
  states: {
    idle: {},
    asking: {
      data: { word: given },
      async run({ data, ask }) {
        const done = await ask('stream', 'QUICK', { word: data.word })
        heard.push(done.ok ? `answer:${done.value}` : 'answer:failed')
        return { at: 'idle' }
      },
      failed: () => ({ at: 'idle' }),
    },
  },
})

/** A backend and a window, where the window's frame comes only when the check says so. */
const wired = (backendStream: State<{}, never, StreamAsks> = stream) => {
  const frames: Array<() => void> = []
  const heard: string[] = []
  const backend = system({ side: 'backend' })
  backend.start('stream', backendStream)
  const window = system({ side: 'window', frame: (run) => { frames.push(run) } })
  window.connect(backend)
  const thePanel = window.start('panel', panel(heard))
  const theQuick = window.start('quick', quick(heard))
  return {
    heard,
    send: (event: PanelEvent): void => window.send(thePanel, event),
    askQuick: (word: string): void => window.send(theQuick, { type: 'ASK_QUICK', word }),
    framesWaiting: (): number => frames.length,
    frame: (): void => { for (const run of frames.splice(0)) run() },
    stop: (): void => { window.stop(); backend.stop() },
  }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['progress arrives as one list, and its own answer is not ahead of it', async () => {
    const it = wired()
    it.send({ type: 'GO', steps: [], burst: 200 })
    await turns(6)
    strictEqual(it.heard.length, 2)
    strictEqual(it.heard[0]!.split('+').length, 200)
    strictEqual(it.heard[1], 'answer:stream:200')
    it.stop()
  }],
  ['a broadcast sent between two pieces of progress is heard between them', async () => {
    const it = wired()
    it.send({ type: 'GO', steps: [{ progress: 'a' }, { progress: 'b' }, { note: 'changed' }, { progress: 'c' }] })
    await turns(8)
    deepStrictEqual(it.heard, ['progress:a+b', 'note:changed', 'progress:c', 'answer:stream:4'])
    it.stop()
  }],
  ['something the user does while progress is waiting is handled after that progress, not before', async () => {
    const it = wired(slowStream)
    it.send({ type: 'GO', steps: [{ progress: 'a' }, { progress: 'b' }] })
    await turns(6)
    deepStrictEqual(it.heard, [])
    it.send({ type: 'CLICK', what: 'stop' })
    deepStrictEqual(it.heard, ['progress:a+b', 'click:stop'])
    it.stop()
  }],
  ['the answer to another ask is not ahead of progress sent before it', async () => {
    const it = wired(slowStream)
    it.send({ type: 'GO', steps: [{ progress: 'a' }] })
    await turns(6)
    it.askQuick('hi')
    await turns(8)
    deepStrictEqual(it.heard, ['progress:a', 'answer:HI'])
    it.stop()
  }],
  ['a frame hands over what is waiting, when nothing else arrives first', async () => {
    const it = wired(slowStream)
    it.send({ type: 'GO', steps: [{ progress: 'a' }, { progress: 'b' }] })
    await turns(6)
    deepStrictEqual(it.heard, [])
    strictEqual(it.framesWaiting(), 1)
    it.frame()
    deepStrictEqual(it.heard, ['progress:a+b'])
    it.stop()
  }],
]

await run(checks)
