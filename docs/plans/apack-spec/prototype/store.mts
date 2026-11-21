// Rows, in memory: what stands in for the app's database where the kernel's rule about rows is checked. The kernel is
// given a `Store` and knows nothing else of it. This one keeps rows in tables and does what the rule needs of any
// store: a write is taken only while a step is open, everything a step wrote is kept at once or not at all, and what
// was written since a mark can be undone on its own.
import type { Store, Unit } from './state.mts'

export type Row = Readonly<Record<string, unknown>>

/** What a write outside a step throws. A handler that has waited is outside one, and returns its writes as a change. */
export const WROTE_OUTSIDE_A_STEP = 'A row is written in a step. After an await a handler is outside one: return the write as part of the change, `(draft) => { … }`, which is made in a step.'

export interface MemoryStore extends Store {
  put(table: string, id: string, row: Row): void
  remove(table: string, id: string): void
  /** As a reader inside the step sees it: with what the step has written so far. */
  get(table: string, id: string): Row | undefined
  ids(table: string): string[]
  /** As anything outside the step sees it: what was last kept. */
  kept(table: string, id: string): Row | undefined
  /** How many steps wrote, and so took the one writer there is. A step that wrote nothing is not one. */
  readonly opened: number
  readonly commits: number
  /** Whether a step has written and not yet been kept or given up. */
  readonly writing: boolean
  /** Makes the next keeping fail, as a full disk would. */
  failNext(why: string): void
}

export function memory(): MemoryStore {
  const tables = new Map<string, Map<string, Row>>()
  const keptRows = new Map<string, Map<string, Row>>()
  const table = (of: Map<string, Map<string, Row>>, name: string): Map<string, Row> => of.get(name) ?? of.set(name, new Map()).get(name)!
  /** How to take back each write of the open step, in the order they were made. */
  let undo: Array<() => void> | undefined
  let stepOpen = false
  let opened = 0
  let commits = 0
  let failing: string | undefined
  const writes = (): Array<() => void> => {
    if (!stepOpen) throw new Error(WROTE_OUTSIDE_A_STEP)
    // The writer is taken at the first write and not when the step begins.
    if (!undo) { undo = []; opened++ }
    return undo
  }
  const back = (to: number): void => { if (undo) for (const take of undo.splice(to).reverse()) take() }
  return {
    put: (name, id, row) => {
      const log = writes()
      const rows = table(tables, name)
      const was = rows.get(id)
      rows.set(id, Object.freeze({ ...row }))
      log.push(() => { if (was === undefined) rows.delete(id); else rows.set(id, was) })
    },
    remove: (name, id) => {
      const log = writes()
      const rows = table(tables, name)
      const was = rows.get(id)
      if (was === undefined) return
      rows.delete(id)
      log.push(() => { rows.set(id, was) })
    },
    get: (name, id) => table(tables, name).get(id),
    ids: (name) => [...table(tables, name).keys()],
    kept: (name, id) => table(keptRows, name).get(id),
    get opened() { return opened },
    get commits() { return commits },
    get writing() { return undo !== undefined },
    failNext: (why) => { failing = why },
    begin: (): Unit => {
      if (stepOpen) throw new Error('A step was begun while another was open')
      stepOpen = true
      const close = (): void => { stepOpen = false; undo = undefined }
      return {
        mark: () => undo?.length ?? 0,
        undo: (mark) => back(mark),
        commit: () => {
          if (!undo) { close(); return }
          if (failing !== undefined) { const why = failing; failing = undefined; back(0); close(); throw new Error(why) }
          keptRows.clear()
          for (const [name, rows] of tables) keptRows.set(name, new Map(rows))
          commits++
          close()
        },
        abort: () => { back(0); close() },
      }
    },
  }
}
