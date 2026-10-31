// The link form's save: a block is stored one way, as `blocks`, and a `blocks` or `parent_of` link that would close a
// loop is refused naming the threads already leading back, leaving every link as it was. A save is the whole list the
// form shows, the blocks on the thread among them, so each case saves what the form would
import { describe, expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { EARS, query } from '#generated/ears.ts'

const thread = (topic: string) => {
  const { id, shortCode } = repository.threadCommands.create({ topic, instructions: '' })
  return { id, code: shortCode }
}
const save = (id: EARS.EntityId, links: Array<{ relation: 'parent_of' | 'blocks' | 'blocked by' | 'duplicates'; id: EARS.EntityId }>) =>
  repository.threadCommands.update(id, { linkedThreads: links })
const blocks = (id: EARS.EntityId) => query.ids(id).out(EARS.RelKind.BLOCKS, EARS.Entity.Thread).ids()

describe('a blocking loop', () => {
  it('is refused when the other thread already blocks this one', () => {
    const [a, b] = [thread('A'), thread('B')]
    save(a.id, [{ relation: 'blocks', id: b.id }])
    expect(() => save(b.id, [{ relation: 'blocked by', id: a.id }, { relation: 'blocks', id: a.id }]))
      .toThrow(`${a.code} already blocks ${b.code}`)
    expect(blocks(b.id)).toEqual([])
    expect(blocks(a.id)).toEqual([b.id])
  })

  it('is refused through a third thread, naming it', () => {
    const [a, b, c] = [thread('A'), thread('B'), thread('C')]
    save(a.id, [{ relation: 'blocks', id: b.id }])
    save(b.id, [{ relation: 'blocked by', id: a.id }, { relation: 'blocks', id: c.id }])
    expect(() => save(c.id, [{ relation: 'blocked by', id: b.id }, { relation: 'blocks', id: a.id }]))
      .toThrow(`${a.code} already blocks ${c.code} through ${b.code}`)
  })

  it('is refused when made by choosing "blocked by"', () => {
    const [a, b] = [thread('A'), thread('B')]
    save(a.id, [{ relation: 'blocks', id: b.id }])
    // A blocked by B is B blocks A
    expect(() => save(a.id, [{ relation: 'blocks', id: b.id }, { relation: 'blocked by', id: b.id }]))
      .toThrow(`${a.code} already blocks ${b.code}`)
  })

  it('leaves every link as it was, the ones the save would have replaced included', () => {
    const [a, b, x] = [thread('A'), thread('B'), thread('X')]
    save(a.id, [{ relation: 'blocks', id: b.id }])
    save(b.id, [{ relation: 'blocked by', id: a.id }, { relation: 'duplicates', id: x.id }])
    expect(() => save(b.id, [{ relation: 'blocked by', id: a.id }, { relation: 'blocks', id: a.id }])).toThrow()
    expect(repository.threadQueries.linkedThreads(b.id).map(({ relation, id }) => [relation, id]))
      .toEqual([['duplicates', x.id], ['blocked by', a.id]])
  })
})

it('refuses a parent loop with the same kind of reason, not the engine\'s', () => {
  const [a, b, c] = [thread('A'), thread('B'), thread('C')]
  save(a.id, [{ relation: 'parent_of', id: b.id }])
  save(b.id, [{ relation: 'parent_of', id: c.id }])
  expect(() => save(c.id, [{ relation: 'parent_of', id: a.id }])).toThrow(`${a.code} is already an ancestor of ${c.code} through ${b.code}`)
  expect(() => save(b.id, [{ relation: 'parent_of', id: a.id }])).toThrow(`${a.code} is already the parent of ${b.code}`)
})

it('refuses a thread linked to itself, whatever the kind, with a reason', () => {
  const a = thread('A')
  expect(() => save(a.id, [{ relation: 'duplicates', id: a.id }])).toThrow(`${a.code} can't duplicate itself`)
  expect(() => save(a.id, [{ relation: 'blocks', id: a.id }])).toThrow(`${a.code} can't block itself`)
})

describe('a link that closes no loop', () => {
  it('is kept, "blocked by" as the other thread\'s block, and a block left off the list is removed', () => {
    const [a, b, c] = [thread('A'), thread('B'), thread('C')]
    save(b.id, [{ relation: 'blocked by', id: a.id }, { relation: 'blocks', id: c.id }])
    expect(blocks(a.id)).toEqual([b.id])
    expect(blocks(b.id)).toEqual([c.id])
    expect(repository.threadQueries.linkedThreads(a.id).map(({ relation, id }) => [relation, id])).toEqual([['blocks', b.id]])
    expect(repository.threadQueries.linkedThreads(b.id).map(({ relation, id }) => [relation, id]))
      .toEqual([['blocks', c.id], ['blocked by', a.id]])
    // Turned around: B no longer blocked by A, and blocking it instead
    save(b.id, [{ relation: 'blocks', id: a.id }, { relation: 'blocks', id: c.id }])
    expect(blocks(a.id)).toEqual([])
    expect(new Set(blocks(b.id))).toEqual(new Set([a.id, c.id]))
  })

  it('is kept in a diamond, where two paths meet without returning', () => {
    const [a, b, c, d] = [thread('A'), thread('B'), thread('C'), thread('D')]
    save(a.id, [{ relation: 'blocks', id: b.id }, { relation: 'blocks', id: c.id }])
    save(b.id, [{ relation: 'blocked by', id: a.id }, { relation: 'blocks', id: d.id }])
    save(d.id, [{ relation: 'blocked by', id: b.id }, { relation: 'blocked by', id: c.id }])
    expect(new Set(blocks(a.id))).toEqual(new Set([b.id, c.id]))
    expect(blocks(b.id)).toEqual([d.id])
    expect(blocks(c.id)).toEqual([d.id])
  })
})
