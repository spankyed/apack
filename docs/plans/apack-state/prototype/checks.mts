// What a check file runs its checks with. Three things, each because a check that fails has to fail, and not hang.
//
// `system` is the kernel's, with every system a check makes stopped when the check ends, however it ends: a check
// that fails part-way leaves nothing running to keep the process alive.
//
// It is also given a limit on how many steps it will take. A kernel that asks itself round without end would
// otherwise go on for good, and the check would never be heard from. The app sets no limit: an agent's loop is one
// thing leading to the next for as long as it runs.
//
// `run` runs the checks and says how many passed.
import { system as kernel, type System } from './state.mts'
import type { Explored } from './schedule.mts'

const made: System[] = []
/** More steps than this in one check is a kernel that does not come to rest. */
const LIMIT = 200_000

export const system: typeof kernel = (host) => {
  const one = kernel({ limit: LIMIT, ...host })
  made.push(one)
  return one
}
/** More turns than this without coming to rest is waiting on what never comes. */
const TURNS = 5_000
const turn = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

/**
 * Waits until everything a check started has come to rest: every system it made has nothing under way. That is what
 * a check means by waiting, where a count of turns is a guess at how long that takes. One that never comes to rest
 * fails, saying so.
 */
export async function rest(): Promise<void> {
  const atRest = (): boolean => made.every((one) => one.idle())
  for (let turns = 0; turns < TURNS; turns++) {
    await turn()
    // Twice, a turn apart: what one thing ending leads to has had its turn to begin.
    if (atRest() && (await turn(), atRest())) return
  }
  throw new Error(`Still not at rest after ${TURNS} turns: something is waiting on what never comes`)
}

const stopAll = (): void => { for (const one of made.splice(0).reverse()) { try { one.stop() } catch { /* it was stopping anyway */ } } }

export interface Tally {
  /** A scenario run under every ordering, or a seed's worth: it passes if none failed and, unless sampled, all were run. */
  every(name: string, explored: () => Promise<Explored>, how?: 'all' | 'sampled'): Promise<void>
  /** One more check, for what is not one of the list. */
  check(name: string, body: () => void | Promise<void>): Promise<void>
}

export async function run(checks: ReadonlyArray<readonly [string, () => void | Promise<void>]>, more?: (tally: Tally) => Promise<void>): Promise<void> {
  const unhandled: unknown[] = []
  process.on('unhandledRejection', (reason) => { unhandled.push(reason) })
  let failed = 0
  let total = 0
  const pass = (name: string, detail = ''): void => { total++; console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`) }
  const fail = (name: string, detail: string): void => { total++; failed++; console.log(`  FAIL  ${name}\n        ${detail}`) }
  const check = async (name: string, body: () => void | Promise<void>): Promise<void> => {
    try { await body(); pass(name) } catch (error) { fail(name, String(error).split('\n').slice(0, 8).join(' ')) } finally { stopAll() }
  }
  for (const [name, body] of checks) await check(name, body)
  await more?.({
    check,
    every: async (name, explored, how = 'all') => {
      try {
        const found = await explored()
        if (found.failure) fail(name, `${String(found.failure.error).split('\n').slice(0, 6).join(' ')}\n        after: ${found.failure.taken.join(' → ')}\n        replay: [${found.failure.choices.join(', ')}]`)
        // An exploration that stopped at its limit proved only what it ran, and says so by failing.
        else if (how === 'all' && !found.complete) fail(name, `stopped at ${found.orderings} orderings with more to run`)
        else if (found.orderings < 2) fail(name, 'there was only one ordering, so nothing was explored')
        else pass(name, `${found.orderings} orderings${how === 'all' ? ', all there are' : ' from one seed, of more than can all be run'}`)
      } catch (error) { fail(name, String(error).split('\n')[0]!) } finally { stopAll() }
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  if (unhandled.length) fail('nothing was left unhandled', String(unhandled[0])); else pass('none of it left a rejection unhandled')
  console.log(`\n${total - failed} of ${total} passed`)
  if (failed) process.exitCode = 1
}
