// Progress is gathered, and nothing else is. These checks hold the order: what a state hears, it hears in the order
// it was sent, whatever kind of message each was.
//
//   npx tsx docs/plans/apack-spec/prototype/progress-check.mts
import { deepStrictEqual, strictEqual } from 'node:assert'
import { reaching, system } from './state.mts'

type StreamAsks = {
  /** Sends each step in turn: a piece of progress, or a note broadcast to every window. */
  STREAM: { args: { steps: Array<{ progress: string } | { note: string }>; burst?: number }; progress: string; answer: { sent: number } }
  QUICK: { args: { word: string }; answer: string }
}
type PanelEvent =
  | { type: 'GO'; steps: Array<{ progress: string } | { note: string }>; burst?: number }
  | { type: 'ASK_QUICK'; word: string }
  | { type: 'CLICK'; what: string }
  | { type: 'NOTE'; note: string }
  | { type: 'HEARD'; pieces: string[] }
  | { type: 'ANSWERED'; what: string }

type App = {
  systems: { stream: { events: never; asks: StreamAsks } }
  surfaces: { panel: { events: PanelEvent } }
  views: {}
}
const state = reaching<App>()

const stream = state<{}, never, StreamAsks>()({
  asks: {
    STREAM: ({ steps, burst }, { progress, broadcast }) => {
      for (const step of steps) { if ('progress' in step) progress(step.progress); else broadcast('panel', { type: 'NOTE', note: step.note }) }
      for (let i = 0; i < (burst ?? 0); i++) progress(`#${i}`)
      return { sent: steps.length + (burst ?? 0) }
    },
    QUICK: ({ word }) => word.toUpperCase(),
  },
})

/** A panel that writes down everything it hears, in the order it hears it. */
const panel = state<{ data: { heard: string[] } }, PanelEvent>()({
  data: { heard: [] },
  on: {
    GO: ({ steps, burst }, { ask, send }) => {
      void ask('stream', 'STREAM', { steps, burst }, (pieces) => send({ type: 'HEARD', pieces: [...pieces] }))
        .then((done) => send({ type: 'ANSWERED', what: done.ok ? `stream:${done.value.sent}` : 'failed' }))
    },
    ASK_QUICK: ({ word }, { ask, send }) => { void ask('stream', 'QUICK', { word }).then((done) => send({ type: 'ANSWERED', what: done.ok ? done.value : 'failed' })) },
    CLICK:    ({ what })   => ({ data: (d) => { d.heard.push(`click:${what}`) } }),
    NOTE:     ({ note })   => ({ data: (d) => { d.heard.push(`note:${note}`) } }),
    HEARD:    ({ pieces }) => ({ data: (d) => { d.heard.push(`progress:${pieces.join('+')}`) } }),
    ANSWERED: ({ what })   => ({ data: (d) => { d.heard.push(`answer:${what}`) } }),
  },
})

const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })

/** A backend and a window, where the window's frame comes only when the check says so. */
const wired = () => {
  const frames: Array<() => void> = []
  const backend = system({ side: 'backend' })
  backend.start('stream', stream)
  const window = system({ side: 'window', frame: (run) => { frames.push(run) } })
  window.connect(backend)
  const handle = window.start('panel', panel)
  return {
    send: (event: PanelEvent): void => window.send(handle, event),
    heard: (): string[] => window.read(handle).data.heard,
    frame: (): void => { for (const run of frames.splice(0)) run() },
    stop: (): void => { window.stop(); backend.stop() },
  }
}

const checks: Array<[string, () => Promise<void>]> = [
  ['progress waits for the frame, and arrives as one list', async () => {
    const it = wired()
    it.send({ type: 'GO', steps: [], burst: 200 })
    await turns(6)
    // The answer came, and brought the progress sent before it with it: nothing is ever behind its own answer.
    strictEqual(it.heard().length, 2)
    strictEqual(it.heard()[0]!.split('+').length, 200)
    strictEqual(it.heard()[1], 'answer:stream:200')
    it.stop()
  }],
  ['a broadcast sent between two pieces of progress is heard between them', async () => {
    const it = wired()
    it.send({ type: 'GO', steps: [{ progress: 'a' }, { progress: 'b' }, { note: 'changed' }, { progress: 'c' }] })
    await turns(8)
    deepStrictEqual(it.heard(), ['progress:a+b', 'note:changed', 'progress:c', 'answer:stream:4'])
    it.stop()
  }],
  ['something the user does while progress is waiting is handled after that progress, not before', async () => {
    const it = wired()
    const frames: Array<() => void> = []
    const backend = system({ side: 'backend' })
    backend.start('stream', state<{}, never, StreamAsks>()({
      asks: {
        // Progress, and then no answer for a long while: the progress is left waiting for a frame.
        STREAM: async ({ steps }, { progress }) => { for (const step of steps) if ('progress' in step) progress(step.progress); await turns(20); return { sent: steps.length } },
        QUICK: ({ word }) => word,
      },
    }))
    const window = system({ side: 'window', frame: (run) => { frames.push(run) } })
    window.connect(backend)
    const handle = window.start('panel', panel)
    window.send(handle, { type: 'GO', steps: [{ progress: 'a' }, { progress: 'b' }] })
    await turns(6)
    deepStrictEqual(window.read(handle).data.heard, [])
    window.send(handle, { type: 'CLICK', what: 'stop' })
    deepStrictEqual(window.read(handle).data.heard, ['progress:a+b', 'click:stop'])
    window.stop(); backend.stop(); it.stop()
  }],
  ['the answer to another ask is not ahead of progress sent before it', async () => {
    const it = wired()
    const frames: Array<() => void> = []
    const backend = system({ side: 'backend' })
    backend.start('stream', state<{}, never, StreamAsks>()({
      asks: {
        STREAM: async ({ steps }, { progress }) => { for (const step of steps) if ('progress' in step) progress(step.progress); await turns(30); return { sent: steps.length } },
        QUICK: ({ word }) => word.toUpperCase(),
      },
    }))
    const window = system({ side: 'window', frame: (run) => { frames.push(run) } })
    window.connect(backend)
    const handle = window.start('panel', panel)
    window.send(handle, { type: 'GO', steps: [{ progress: 'a' }] })
    await turns(6)
    window.send(handle, { type: 'ASK_QUICK', word: 'hi' })
    await turns(8)
    deepStrictEqual(window.read(handle).data.heard, ['progress:a', 'answer:HI'])
    window.stop(); backend.stop(); it.stop()
  }],
  ['a frame hands over what is waiting, when nothing else arrives first', async () => {
    const frames: Array<() => void> = []
    const backend = system({ side: 'backend' })
    backend.start('stream', state<{}, never, StreamAsks>()({
      asks: {
        STREAM: async ({ steps }, { progress }) => { for (const step of steps) if ('progress' in step) progress(step.progress); await turns(40); return { sent: steps.length } },
        QUICK: ({ word }) => word,
      },
    }))
    const window = system({ side: 'window', frame: (run) => { frames.push(run) } })
    window.connect(backend)
    const handle = window.start('panel', panel)
    window.send(handle, { type: 'GO', steps: [{ progress: 'a' }, { progress: 'b' }] })
    await turns(6)
    deepStrictEqual(window.read(handle).data.heard, [])
    strictEqual(frames.length, 1)
    for (const run of frames.splice(0)) run()
    deepStrictEqual(window.read(handle).data.heard, ['progress:a+b'])
    window.stop(); backend.stop()
  }],
]

let failed = 0
for (const [name, check] of checks) {
  try { await check(); console.log(`  ok    ${name}`) } catch (error) { failed++; console.log(`  FAIL  ${name}\n        ${String(error).split('\n').slice(0, 6).join(' ')}`) }
}
console.log(`\n${checks.length - failed} of ${checks.length} passed`)
if (failed) process.exitCode = 1
