// Rows, as the kernel's rule about them is checked: one interface, kept two ways. `memory` keeps rows in maps, and
// `store-elmdb.mts` keeps them in the app's engine. The kernel is given `transact` and nothing else of either.
//
// `transact` is the engine's: it runs a function as one unit, a throw undoes what it wrote, one inside another joins
// it and is undone alone when it throws, and the writer is taken at the first write. The rest is what a check reads
// rows with, and the rule a pack's engine holds: a write is made inside a unit.

export type Row = Readonly<Record<string, unknown>>
export type Table = 'thread' | 'link' | 'import'

/** What a write outside a unit throws. A handler that has waited is outside its step, and returns its writes as a change. */
export const WROTE_OUTSIDE_A_STEP = 'A row is written in a step. After an await a handler is outside one: return the write as part of the change, `{ data: (draft) => { … } }`, which is made in a step.'

export interface Rows {
  /** What the kernel is given. */
  transact<T>(run: () => T): T
  put(table: Table, id: string, row: Row): void
  remove(table: Table, id: string): void
  /** Joins two threads, both of which there have to be: a join to a thread written later is refused where it is written. */
  join(from: string, to: string): void
  joined(from: string, to: string): boolean
  /** As whoever is reading sees it: with what the open unit has written, inside one. */
  get(table: Table, id: string): Row | undefined
  count(table: Table): number
  /** How many units wrote, and so took the one writer there is. */
  readonly opened: number
  readonly commits: number
  /** Whether a unit has written and not yet been kept or given up. */
  readonly writing: boolean
  /** Makes the next keeping fail, as a full disk would. */
  failNext(why: string): void
  /**
   * Reads now, and again after each keeping, telling `heard` the first result and each one after that differs: what
   * a view is. It is told later, never as the rows are written. Returns what stops it.
   */
  watch<T>(read: () => T, heard: (value: T) => void): () => void
  /** Calls `then` once every watch has been told of what was kept before this call. */
  settled(then: () => void): void
  close(): void
}

/** `later` runs something after what it was given before: a check gives a lane of its schedule, to choose when. */
export function memory(later: (run: () => void) => void = (run) => { setImmediate(run) }): Rows {
  const watches = new Set<{ again(): void }>()
  const tables = new Map<string, Map<string, Row>>()
  const table = (name: string): Map<string, Row> => tables.get(name) ?? tables.set(name, new Map()).get(name)!
  const joins = new Set<string>()
  /** How deep in units the code running is. */
  let depth = 0
  /** How to take back each write of the open unit, in the order they were made: there once the unit has written. */
  let undo: Array<() => void> | undefined
  let opened = 0
  let commits = 0
  let failing: string | undefined
  const writes = (): Array<() => void> => {
    if (depth === 0) throw new Error(WROTE_OUTSIDE_A_STEP)
    if (!undo) { undo = []; opened++ }
    return undo
  }
  const back = (to: number): void => { if (undo) for (const take of undo.splice(to).reverse()) take() }
  return {
    transact: (run) => {
      const mark = undo?.length ?? 0
      depth++
      let value: ReturnType<typeof run>
      try { value = run() } catch (error) {
        depth--
        back(mark)
        if (depth === 0) undo = undefined
        throw error
      }
      depth--
      if (depth > 0 || !undo) return value
      const wrote = undo.length > 0
      const why = failing
      if (wrote && why !== undefined) { failing = undefined; back(0); undo = undefined; throw new Error(why) }
      undo = undefined
      if (wrote) { commits++; for (const watch of watches) later(watch.again) }
      return value
    },
    put: (name, id, row) => {
      const log = writes()
      const rows = table(name)
      const was = rows.get(id)
      rows.set(id, Object.freeze({ ...row }))
      log.push(() => { if (was === undefined) rows.delete(id); else rows.set(id, was) })
    },
    remove: (name, id) => {
      const log = writes()
      const rows = table(name)
      const was = rows.get(id)
      if (was === undefined) return
      rows.delete(id)
      log.push(() => { rows.set(id, was) })
    },
    join: (from, to) => {
      const log = writes()
      for (const end of [from, to]) if (!table('thread').has(end)) throw new Error(`join(${from}, ${to}): no thread has the id ${end}`)
      const pair = `${from}>${to}`
      if (joins.has(pair)) return
      joins.add(pair)
      log.push(() => { joins.delete(pair) })
    },
    joined: (from, to) => joins.has(`${from}>${to}`),
    get: (name, id) => table(name).get(id),
    count: (name) => table(name).size,
    get opened() { return opened },
    get commits() { return commits },
    get writing() { return undo !== undefined },
    failNext: (why) => { failing = why },
    watch: (read, heard) => {
      let last: string | undefined
      const watch = { again: (): void => {
        if (!watches.has(watch)) return
        const value = read()
        const now = JSON.stringify(value)
        if (now !== last) { last = now; heard(value) }
      } }
      watches.add(watch)
      later(watch.again)
      return () => { watches.delete(watch) }
    },
    settled: (then) => later(then),
    close: () => { watches.clear() },
  }
}
