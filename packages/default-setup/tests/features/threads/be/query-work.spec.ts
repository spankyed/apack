// Baseline readings for the query-efficiency investigation (docs/plans/ears-query-efficiency.md): what each candidate
// view costs in crossings, rows visited and re-runs, at two sizes of the same fixture.
import { describe, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { testCalls } from '@apackdev/sdk/testing'
import { repository } from '#generated/repository.ts'
import { query, transact, EARS } from '#generated/ears.ts'

const say = (threadId: EARS.EntityId, text: string, sender: 'user' | 'assistant' | 'marker' = 'user') =>
  repository.chatCommands.addMessage({ threadId, text, sender, skipRelink: true }).id as EARS.EntityId

/** `threads` threads, the first holding `messages` messages (three queued, every 50th mentioning a deploy, the newest
 * five of those markers), one archived, one a parent of another; and `notes` notes */
function populate(threads: number, messages: number, notes: number) {
  return transact(() => {
    const ids = Array.from({ length: threads }, (_, i) =>
      repository.threadCommands.create({ topic: `Thread ${i}`, instructions: '' }).id as EARS.EntityId)
    const big = ids[0]!
    const deploys: EARS.EntityId[] = []
    for (let m = 0; m < messages; m++) {
      const mentions = m % 50 === 0
      const id = say(big, mentions ? `the deploy ${m} went out` : `message ${m}`, m % 2 ? 'assistant' : 'user')
      if (mentions) deploys.push(id)
    }
    for (let k = 0; k < Math.min(5, deploys.length); k++) say(big, 'deploy summary', 'marker')
    for (let i = 1; i < threads; i++) say(ids[i]!, `hello ${i}`)
    const queued = [say(big, 'queued 1'), say(big, 'queued 2'), say(big, 'queued 3')]
    for (const id of queued) repository.chatCommands.updateMessageState({ messageId: id, updates: { status: 'queued' } })
    repository.threadCommands.update(ids[threads - 1]!, { archived: true })
    repository.threadCommands.setParent(ids[1]!, [ids[2]!])
    for (let n = 0; n < notes; n++) repository.noteCommands.create({ title: `Note ${n}`, content: `body ${n}` })
    return { big, other: ids[3]! }
  })
}

function counted<T>(read: () => T): { answer: T; reads: number; plans: number; ms: number } {
  testCalls().start()
  const answer = read()
  const { totals } = testCalls().stop()
  return { answer, reads: totals.read.calls, plans: totals.read.ops, ms: totals.read.ms }
}

function median(read: () => unknown, runs = 15): number {
  const times: number[] = []
  for (let r = 0; r < runs; r++) {
    const start = performance.now()
    read()
    times.push(performance.now() - start)
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!
}

describe('query work, baseline', () => {
  for (const [threads, messages, notes] of [[100, 1000, 250], [200, 2000, 500]] as const) {
    it(`${threads} threads, ${messages} messages, ${notes} notes`, async () => {
      const { big, other } = populate(threads, messages, notes)
      const app = await startApp({ systems: ['threads', 'notes'] })
      const reading: Record<string, unknown> = {}

      const chat = () => repository.chatQueries.chatPage(big, 50)
      const page = counted(chat)
      reading.chat = {
        reads: page.reads, plans: page.plans, ids: page.answer?.messageIds.length, hasMore: page.answer?.hasMore,
        displayOrderVisited: query.ids(big).out(EARS.RelKind.CONTAINS, EARS.Entity.Message).explain().visited,
        medianMs: median(chat),
      }

      const list = () => repository.threadQueries.listed()
      const listed = counted(list)
      reading.list = {
        reads: listed.reads, plans: listed.plans, rows: listed.answer.length,
        fieldsPerRow: Object.keys(listed.answer[0] ?? {}).length,
        visited: query(EARS.Entity.Thread).explain().visited, medianMs: median(list),
      }

      const search = () => repository.chatQueries.searchMessages('deploy')
      const searched = counted(search)
      const matches = query(EARS.Entity.Message).search('deploy', { prefix: true }).ids().length
      reading.messageSearch = {
        reads: searched.reads, plans: searched.plans, results: searched.answer.length, matches, medianMs: median(search),
      }

      const notesSearch = () => repository.noteQueries.search('note 1')
      const found = counted(notesSearch)
      reading.notesSearch = { reads: found.reads, plans: found.plans, results: found.answer.length, medianMs: median(notesSearch) }

      // Re-runs from a write none of these views shows: visiting another thread, and a reply streamed in another thread
      const views = {
        chat: app.watchView('threads', 'chat', { threadId: big, limit: 50 }),
        list: app.watchView('threads', 'list'),
        messageSearch: app.watchView('threads', 'messageSearch', { query: 'deploy' }),
        notesSearch: app.watchView('notes', 'search', { text: 'note 1' }),
      }
      for (const view of Object.values(views)) await view.next()
      repository.threadCommands.markAsVisited(other)
      await app.settle()
      const afterVisit = Object.fromEntries(Object.entries(views).map(([n, v]) => [n, v.updates.length - 1]))
      const reply = say(other, '', 'assistant')
      await app.settle()
      for (let f = 0; f < 5; f++) {
        repository.chatCommands.updateMessageState({ messageId: reply, updates: { text: 'x'.repeat(f + 1) } })
        await app.settle()
      }
      const afterReply = Object.fromEntries(Object.entries(views).map(([n, v]) => [n, v.updates.length - 1]))
      reading.reruns = { afterVisit, afterReplyAndFiveFlushes: afterReply }

      console.log(`READING ${threads}/${messages}/${notes} ${JSON.stringify(reading)}`)
    }, 300_000)
  }
})
