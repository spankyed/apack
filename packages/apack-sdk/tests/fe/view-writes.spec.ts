// A surface's own writes over a view it shows: a result arriving while any write is unanswered is held, and once the
// last is answered the view is read again if one was held or a write was refused — and otherwise the next result is
// applied as it comes, since it carries the last write.
import { describe, expect, it } from 'vitest'
import { viewRead, viewWrites, writeEnded, writeSent, writing } from '../../src/fe/view-writes.ts'

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
    writes = writeEnded(read.writes, 'c-1')
    expect(writes).toEqual({ pending: {}, stale: false, refreshes: 1 })
  })

  it('reads nothing again when nothing was held, the next result carrying the write', () => {
    const writes = writeEnded(writeSent(viewWrites(), 'c-1'), 'c-1')
    expect(writes.refreshes).toBe(0)
  })

  it('waits for the last of several writes', () => {
    let writes = writeSent(writeSent(viewWrites(), 'c-1'), 'c-2')
    writes = viewRead(writes).writes
    writes = writeEnded(writes, 'c-1')
    expect(writes).toMatchObject({ stale: true, refreshes: 0 })
    expect(viewRead(writes).apply, 'the second is still unanswered').toBe(false)
    expect(writeEnded(writes, 'c-2').refreshes).toBe(1)
  })

  it('reads the view again after a refusal, which leaves the edit on screen unstored', () => {
    expect(writeEnded(writeSent(viewWrites(), 'c-1'), 'c-1', true).refreshes).toBe(1)
  })

  it('ignores an answer to a write it holds no record of', () => {
    const writes = writeSent(viewWrites(), 'c-1')
    expect(writeEnded(writes, 'c-elsewhere')).toBe(writes)
  })
})
