// The same rows, kept in the app's engine: elmdb, through `@elmdb/ears`, on a temporary database. `transact` is the
// engine's own, handed to the kernel as it is. Around it is what a check counts with (how often the writer was taken,
// whether a unit is open) and what a pack's engine has to do: refuse a write made outside a unit.
//
// Run from a checkout with its dependencies installed.
import { createEarsEngine } from '@elmdb/ears'
import { createTemporaryDatabases } from '@elmdb/ears/database'
import { WROTE_OUTSIDE_A_STEP, type Row, type Rows, type Table } from './store.mts'

const databases = createTemporaryDatabases()
const TYPES = { thread: 'Thread', link: 'Link', import: 'Import' } as const satisfies Record<Table, string>
const rules = { required: [], types: {}, indexes: [] }

/** The engine's untyped face, as far as this file uses it: its types are a pack's to narrow, and there is none here. */
interface Engine {
  transact<T>(run: () => T): T
  upsert(type: string, row: Record<string, unknown>): unknown
  write(id: string): { destroy(): void; link(kind: string, to: string): void }
  getRow(id: string): Record<string, unknown> | undefined
  findRelations(match: { source: string; target: string; kind: string }): unknown[]
  catalog(): { types: ReadonlyArray<{ name: string; count: number }> }
  lastCommit(): number
  watch<T>(read: () => T, heard: (value: T, commit: number) => void): { stop(): void }
  /** What only whoever made the engine holds. */
  admin: { watchesSettled(): Promise<void> }
}

export interface ElmdbRows extends Rows { readonly engine: Engine }

export function elmdb(): ElmdbRows {
  const opened = databases.open({ types: { Thread: rules, Link: rules, Import: rules }, relations: { parent_of: {} }, roles: [] })
  let taken = 0
  let open = false
  let failing: string | undefined
  // The database, with its units counted: when one is begun the writer is taken, and it is held until it ends.
  const through = <T extends object>(target: T, over: Partial<Record<string, (...given: never[]) => unknown>>): T => new Proxy(target, {
    get: (of, key) => {
      const mine = typeof key === 'string' ? over[key] : undefined
      if (mine) return mine
      const value = Reflect.get(of, key, of) as unknown
      return typeof value === 'function' ? (value as (...given: unknown[]) => unknown).bind(of) : value
    },
  })
  const database = through(opened.database, {
    begin: () => {
      const unit = opened.database.begin()
      taken++
      open = true
      return through(unit, {
        commit: (durable?: boolean | null) => {
          open = false
          if (failing !== undefined) { const why = failing; failing = undefined; unit.abort(); throw new Error(why) }
          return unit.commit(durable)
        },
        abort: () => { open = false; unit.abort() },
      })
    },
  })
  const engine = createEarsEngine({ database }) as unknown as Engine
  const started = engine.lastCommit()
  let depth = 0
  const idOf = (table: Table, id: string): string => `${TYPES[table]}-${id}`
  const inUnit = (): void => { if (depth === 0) throw new Error(WROTE_OUTSIDE_A_STEP) }
  const plain = (row: Record<string, unknown> | undefined): Row | undefined => {
    if (!row) return undefined
    const { id: _id, entityType: _type, createdAt: _made, updatedAt: _changed, ...fields } = row
    return fields
  }
  return {
    engine,
    transact: (run) => { depth++; try { return engine.transact(run) } finally { depth-- } },
    put: (table, id, row) => { inUnit(); engine.upsert(TYPES[table], { id: idOf(table, id), ...row }) },
    remove: (table, id) => { inUnit(); if (engine.getRow(idOf(table, id))) engine.write(idOf(table, id)).destroy() },
    join: (from, to) => { inUnit(); engine.write(idOf('thread', from)).link('parent_of', idOf('thread', to)) },
    joined: (from, to) => engine.findRelations({ source: idOf('thread', from), target: idOf('thread', to), kind: 'parent_of' }).length > 0,
    get: (table, id) => plain(engine.getRow(idOf(table, id))),
    count: (table) => engine.catalog().types.find((type) => type.name === TYPES[table])?.count ?? 0,
    get opened() { return taken },
    get commits() { return engine.lastCommit() - started },
    get writing() { return open },
    failNext: (why) => { failing = why },
    watch: (read, heard) => { const watching = engine.watch(read, (value) => heard(value)); return () => watching.stop() },
    // The engine's own timers do not keep a process alive, so while this waits something else has to.
    settled: (then) => {
      const alive = setInterval(() => {}, 1_000)
      void engine.admin.watchesSettled().finally(() => clearInterval(alive)).then(then)
    },
    close: () => opened.dispose(),
  }
}
