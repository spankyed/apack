// A surface's own writes over a view it shows: a result arriving while any write is unanswered is held, and once the
// last is answered the view is read again if one was held or a write was refused — and otherwise the next result is
// applied as it comes, since it carries the last write.
import { describe, expect, it } from 'vitest'
import { _CALL_KEY } from '../../src/events/index.ts'
import { viewRead, viewWrites, writeAnswered, writeSent, writing } from '../../src/fe/view-writes.ts'

/** An answer to `call`, as a delivery door hands it on */
const answer = (call: string) => ({ type: 'WRITTEN', [_CALL_KEY]: call })

describe('view writes', () => {
  it('applies a result at once while nothing is unanswered', () => {
    const { apply, writes } = viewRead(viewWrites())
    expect(apply).toBe(true)
    expect(writes).toEqual(viewWrites())
  })

  it('holds a result behind an unanswered write, and reads the view again once it is answered', () => {
    let writes = writeSent(viewWrites(), 'c-1')
    expect(writing(writes)).toBe(true)
    const read = viewRead(writes)
    expect(read.apply).toBe(false)
    writes = writeAnswered(read.writes, answer('c-1'))
    expect(writes).toEqual({ pending: {}, stale: false, refreshes: 1 })
  })

  it('reads nothing again when nothing was held, the next result carrying the write', () => {
    const writes = writeAnswered(writeSent(viewWrites(), 'c-1'), answer('c-1'))
    expect(writes.refreshes).toBe(0)
  })

  it('waits for the last of several writes', () => {
    let writes = writeSent(writeSent(viewWrites(), 'c-1'), 'c-2')
    writes = viewRead(writes).writes
    writes = writeAnswered(writes, answer('c-1'))
    expect(writes).toMatchObject({ stale: true, refreshes: 0 })
    expect(viewRead(writes).apply, 'the second is still unanswered').toBe(false)
    expect(writeAnswered(writes, answer('c-2')).refreshes).toBe(1)
  })

  it('reads the view again after a refusal, which leaves the edit on screen unstored', () => {
    expect(writeAnswered(writeSent(viewWrites(), 'c-1'), answer('c-1'), true).refreshes).toBe(1)
  })

  it('ignores an answer to a write it holds no record of', () => {
    const writes = writeSent(viewWrites(), 'c-1')
    expect(writeAnswered(writes, answer('c-elsewhere'))).toBe(writes)
    expect(writeAnswered(writes, { type: 'WRITTEN' })).toBe(writes)
  })
})
