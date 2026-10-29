// What the threads and notes views cost, at two sizes of one fixture: work that stays the same as the data grows, held by
// crossings to elmdb (`testCalls`) and by what a view re-runs on. docs/references/evidence/ears-query-efficiency.md has
// the readings before and after.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { testCalls } from '@apackdev/sdk/testing'
import { repository } from '#generated/repository.ts'
import { chatService } from '#features/threads/be/services/chat.ts'
import { query, transact, EARS } from '#generated/ears.ts'

const SIZES = [1, 2] as const

const say = (threadId: EARS.EntityId, text: string, sender: 'user' | 'assistant' | 'marker' = 'user') =>
  repository.chatCommands.addMessage({ threadId, text, sender, skipRelink: true }).id as EARS.EntityId

/**
 * `40 × size` threads, the first holding `300 × size` messages, every 10th mentioning a deploy, then five markers and
 * three queued messages; the second a parent of the third, the last archived; and `60 × size` notes, the first holding
 * the second
 */
function populate(size: number) {
  return transact(() => {
    const threads = Array.from({ length: 40 * size }, (_, i) =>
      repository.threadCommands.create({ topic: `Thread ${i}`, instructions: '' }).id as EARS.EntityId)
    const big = threads[0]!
    const messages = Array.from({ length: 300 * size }, (_, m) =>
      say(big, m % 10 === 0 ? `the deploy ${m} went out` : `message ${m}`, m % 2 ? 'assistant' : 'user'))
    for (let k = 0; k < 5; k++) say(big, 'deploy summary', 'marker')
    for (const text of ['queued 1', 'queued 2', 'queued 3']) {
      repository.chatCommands.updateMessageState({ messageId: say(big, text), updates: { status: 'queued' } })
    }
    for (const id of threads.slice(1)) say(id, 'hello')
    repository.threadCommands.setParent(threads[1]!, [threads[2]!])
    repository.threadCommands.update(threads.at(-1)!, { archived: true })
    const first = repository.noteCommands.create({ title: 'Note 0', content: 'body 0' }).id
    for (let n = 1; n < 60 * size; n++) {
      const note = { title: `Note ${n}`, content: `body ${n}` }
      repository.noteCommands.create(n === 1 ? { ...note, parentId: first } : note)
    }
    return { big, messages }
  })
}

/** A read's answer and how many reads of elmdb it made */
function counted<T>(read: () => T): { answer: T; reads: number } {
  if (process.env.EARS_EVALUATION_BACKEND === 'sqlite') {
    expect(query(EARS.Entity.Thread).explain()).toMatchObject({ backend: 'sqlite' })
  }
  testCalls().start()
  const answer = read()
  return { answer, reads: testCalls().stop().totals.read.calls }
}

describe('what a view costs as the data grows', () => {
  for (const size of SIZES) {
    it(`reads as much at ×${size}: the chat page, the list, both searches`, async () => {
      const { big, messages } = populate(size)
      await startApp({ systems: ['threads', 'notes'] })

      const page = counted(() => repository.chatQueries.chatPage(big, 50))
      expect(page.answer?.messageIds).toHaveLength(53)
      expect(page.answer?.hasMore).toBe(true)
      expect(page.reads).toBe(2)

      const list = counted(() => repository.threadQueries.listed())
      expect(list.answer).toHaveLength(40 * size - 1)
      expect(list.answer.find(t => t.parentId)).toBeDefined()
      expect(list.reads, 'every parent in one read, not one a thread').toBe(2)

      const search = counted(() => repository.chatQueries.searchMessages('deploy'))
      expect(search.answer, 'a full page, the markers left out before it is cut').toHaveLength(20)
      expect(search.answer.every(r => r.sender !== 'marker' && r.topic === 'Thread 0')).toBe(true)
      expect(search.reads, 'the matches, asked again once for the markers, then threads and topics').toBe(4)

      const notes = counted(() => repository.noteQueries.search('note 1'))
      expect(notes.answer.length).toBeGreaterThan(10)
      expect(notes.reads, 'the notes, then parents and children for the matches in a read each').toBe(3)

      expect(messages).toHaveLength(300 * size)
    })
  }

  it('pages a thread shorter than its limit whole, an empty one empty, and keeps the queued last after a bulk add', async () => {
    await startApp({ systems: ['threads'] })
    const empty = repository.threadCommands.create({ topic: 'Empty', instructions: '' }).id as EARS.EntityId
    expect(repository.chatQueries.chatPage(empty, 50)).toMatchObject({ messageIds: [], hasMore: false })

    const short = repository.threadCommands.create({ topic: 'Short', instructions: '' }).id as EARS.EntityId
    const first = say(short, 'one')
    const waiting = say(short, 'waiting')
    repository.chatCommands.updateMessageState({ messageId: waiting, updates: { status: 'queued' } })
    // More than a page of two reads back from the end, so a queued message left behind them would be missed
    const imported = Array.from({ length: 8 }, (_, i) => ({ text: `imported ${i}`, sender: 'user' as const }))
    chatService.addMessagesToThread({ threadId: short, messages: imported })
    const whole = repository.chatQueries.chatPage(short, 50)!
    expect(whole.messageIds).toHaveLength(10)
    expect(whole.messageIds[0]).toBe(first)
    expect(whole.messageIds.at(-1)).toBe(waiting)
    expect(whole.hasMore).toBe(false)
    expect(repository.chatQueries.chatPage(short, 2), 'the last two others, then the queued one, after the bulk add')
      .toMatchObject({ messageIds: [...whole.messageIds.slice(7, 9), waiting], hasMore: true })
  })

  it('runs the chat page again for a change on the page, not for one to a message before it', async () => {
    const { big, messages } = populate(1)
    const app = await startApp({ systems: ['threads'] })
    const chat = app.watchView<{ messageIds: string[] } | null>('threads', 'chat', { threadId: big, limit: 50 })
    await chat.next()
    // Both writes in one turn, each one commit: a commit into what the page read while it waits to run is one whose
    // state it skips, so the count says whether the first write was one
    testCalls().start()
    transact(() => repository.chatCommands.updateMessageState({ messageId: messages[0]!, updates: { status: 'cancelled' } }))
    transact(() => repository.chatCommands.updateMessageState({ messageId: messages.at(-1)!, updates: { status: 'queued' } }))
    const update = await chat.next()
    const { watches } = testCalls().stop()
    expect(update.ok && update.value?.messageIds.at(-1), 'the page follows the second write').toBe(messages.at(-1))
    expect(watches.map(w => w.skipped), 'the first message is far before the page, which reads none of it').toEqual([0])
  })
})
