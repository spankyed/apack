// The console shows a query's explain() as its plan's stages, and every other result as it did: told apart by the
// shape the engine answers, which this reads off a real explanation rather than writing one out
import { describe, expect, it } from 'vitest'
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
})
