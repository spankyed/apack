// The console shows a query's explain() as its plan's stages, and every other result as it did: told apart by the
// shape the engine answers, which this reads off a real explanation rather than writing one out
import { describe, expect, it } from 'vitest'
import type { QueryExplanation } from '@apackdev/ears'
import { query, EARS } from '#generated/ears.ts'
import { repository } from '#generated/repository.ts'
import { isExplanation } from '#features/database/fe/components/simple-table/composables/explanation.ts'

describe("the console's explanation display", () => {
  it("takes what explain() answers, and no other result a query returns", () => {
    repository.threadCommands.create({ topic: 'Pinned', instructions: '' })
    const explained = query(EARS.Entity.Thread).where('pinned', false).explain()
    expect(isExplanation(explained)).toBe(true)
    expect(isExplanation(JSON.parse(JSON.stringify(explained))), 'as it arrives over the bus').toBe(true)
    for (const other of [
      query(EARS.Entity.Thread).ids(),
      query(EARS.Entity.Thread).pickAll(),
      query(EARS.Entity.Thread).pickOne(),
      query(EARS.Entity.Thread).count(),
      { ids: [], visited: 0, ms: 0 },
      null,
    ]) expect(isExplanation(other), JSON.stringify(other)).toBe(false)
  })

  it('recognizes SQLite plans without inventing native stage counters', () => {
    const explained = { backend: 'sqlite', statementCount: 1, ids: [], ms: 1, statements: [{
      sql: 'SELECT id FROM entities', parameters: [], returnedRows: 0, ms: 0.5,
      plan: [{ id: 1, parent: 0, detail: 'SCAN entities' }],
    }] } satisfies QueryExplanation
    expect(isExplanation(explained)).toBe(true)
    expect(isExplanation(JSON.parse(JSON.stringify(explained)))).toBe(true)
    for (const other of [
      { ...explained, backend: 'unknown' },
      { ...explained, statementCount: 0 },
      { ...explained, ms: NaN },
      { ...explained, statements: [{ ...explained.statements[0], returnedRows: -1 }] },
      { ...explained, statements: [{ ...explained.statements[0], plan: [null] }] },
      { ids: [], visited: 0, ms: 0, stages: [] },
    ]) expect(isExplanation(other)).toBe(false)
  })

})
