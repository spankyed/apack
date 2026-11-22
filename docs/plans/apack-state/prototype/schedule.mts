// A schedule a check gives the kernel in place of the event loop, so that the order things happen in is chosen and not
// left to timing. Everything the kernel puts off goes into a lane: what crosses a link one way, a system's frames. A
// check adds lanes of its own: what a user does, and outside work that finishes when the schedule gets to it.
//
// What is in one lane keeps its order. Between lanes the schedule chooses, and `explore` runs a scenario once for
// every way of choosing. A failure comes back with the choices that led to it, and `replay` runs exactly those again.
import { MessageChannel } from 'node:worker_threads'
import type { Lane } from './state.mts'

type Task = { readonly what: string; run(): void }

export interface Schedule {
  /** What a system is given as `later`. */
  later(lane: Lane, run: () => void): void
  /** A lane of the check's own: things done one after another, such as what a user clicks. */
  does(label: string, ...steps: ReadonlyArray<readonly [what: string, run: () => void]>): void
  /** Outside work, in a lane of its own: it is done, with this value, when the schedule gets to it. */
  work<T>(label: string, value: T): Promise<T>
  /** The same, for work that fails. */
  breaks(label: string, error: Error): Promise<never>
}

/** How one run went: each choice made, how many there were to choose from, and what was run, in order. */
interface Run { choices: number[]; counts: number[]; taken: string[]; error?: unknown }

/**
 * Lets every promise that can settle do so: a message is delivered on a turn of the event loop, which comes after all
 * of them. A message and not `setImmediate`, which costs fifty times as much and is paid once per thing run.
 */
const turn = new MessageChannel()
let onTurn: (() => void) | undefined
turn.port1.on('message', () => { const resolve = onTurn; onTurn = undefined; resolve?.() })
// The channel keeps the process alive only while a run is waiting on it.
turn.port1.unref()
const settled = (): Promise<void> => new Promise((resolve) => { onTurn = resolve; turn.port2.postMessage(0) })

/** More than this in one run is two things telling each other forever. */
const RUNAWAY = 10_000

async function once(scenario: (schedule: Schedule) => () => void, choose: (depth: number, among: number) => number): Promise<Run> {
  const lanes = new Map<Lane, Task[]>()
  const into = (lane: Lane, task: Task): void => { (lanes.get(lane) ?? lanes.set(lane, []).get(lane)!).push(task) }
  const schedule: Schedule = {
    later: (lane, run) => into(lane, { what: lane.label, run }),
    does: (label, ...steps) => { const lane: Lane = { label }; for (const [what, run] of steps) into(lane, { what: `${label}: ${what}`, run }) },
    work: (label, value) => new Promise((resolve) => { into({ label }, { what: label, run: () => resolve(value) }) }),
    breaks: (label, error) => new Promise((_, reject) => { into({ label }, { what: label, run: () => reject(error) }) }),
  }
  const made: Run = { choices: [], counts: [], taken: [] }
  turn.port1.ref()
  try {
    const check = scenario(schedule)
    for (;;) {
      await settled()
      const ready = [...lanes.values()].filter((waiting) => waiting.length)
      if (!ready.length) break
      if (made.taken.length >= RUNAWAY) throw new Error(`Still going after ${RUNAWAY} things: something never comes to rest`)
      // Only a real choice is written down, so that the choices are as short as the ordering they name.
      let chosen = 0
      if (ready.length > 1) { chosen = choose(made.choices.length, ready.length); made.choices.push(chosen); made.counts.push(ready.length) }
      const task = ready[chosen]!.shift()!
      made.taken.push(task.what)
      task.run()
    }
    check()
  } catch (error) { made.error = error } finally { turn.port1.unref() }
  return made
}

export interface Explored {
  /** How many orderings were run. */
  readonly orderings: number
  /** Whether that was every one. False when a failure stopped it, or the limit did. */
  readonly complete: boolean
  readonly failure?: { readonly choices: readonly number[]; readonly taken: readonly string[]; readonly error: unknown }
}

/**
 * Runs a scenario under every ordering its lanes allow, stopping at the first that fails. The scenario builds what it
 * checks from the schedule it is handed, and returns what must hold once everything has come to rest.
 */
export async function explore(scenario: (schedule: Schedule) => () => void, options: { limit?: number } = {}): Promise<Explored> {
  const limit = options.limit ?? 50_000
  let prefix: number[] = []
  for (let orderings = 1; ; orderings++) {
    const made = await once(scenario, (depth) => prefix[depth] ?? 0)
    if ('error' in made) return { orderings, complete: false, failure: { choices: made.choices, taken: made.taken, error: made.error } }
    // The next ordering: the last choice that had another way to go, taken that way, and everything after it afresh.
    let last = made.choices.length - 1
    while (last >= 0 && made.choices[last]! + 1 >= made.counts[last]!) last--
    if (last < 0) return { orderings, complete: true }
    if (orderings >= limit) return { orderings, complete: false }
    prefix = [...made.choices.slice(0, last), made.choices[last]! + 1]
  }
}

/** Runs a scenario under orderings chosen at random from a seed, for one with too many to run them all. */
export async function sample(scenario: (schedule: Schedule) => () => void, options: { seed: number; runs: number }): Promise<Explored> {
  let state = options.seed >>> 0
  const random = (): number => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  for (let orderings = 1; orderings <= options.runs; orderings++) {
    const made = await once(scenario, (_, among) => Math.floor(random() * among))
    if ('error' in made) return { orderings, complete: false, failure: { choices: made.choices, taken: made.taken, error: made.error } }
  }
  return { orderings: options.runs, complete: false }
}

/** Runs a scenario under one ordering: the choices a failure came back with. Returns what it threw, if it did. */
export async function replay(scenario: (schedule: Schedule) => () => void, choices: readonly number[]): Promise<{ taken: readonly string[]; error?: unknown }> {
  const made = await once(scenario, (depth) => choices[depth] ?? 0)
  return 'error' in made ? { taken: made.taken, error: made.error } : { taken: made.taken }
}
