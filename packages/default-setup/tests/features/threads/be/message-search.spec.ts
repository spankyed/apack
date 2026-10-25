// The threads panel's message search: what `SEARCH_MESSAGES` answers, to the window that asked. Matching and ranking
// are elmdb's (its text specs) and the builder's (`apack-ears/tests/engine/search.spec.ts`); this holds the feature to
// what its panel lists — newer before older, a snippet around the match, each message's thread, no compaction marker.
import { describe, expect, it, vi } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { snippetOf } from '#features/threads/be/repository/index.ts'

const THREADS = 'default-setup/threads'
const MAIN = 'c-main'

describe('searching messages', () => {
  it('answers each match, newer first, with its thread and a marked snippet', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    const older = repository.threadCommands.create({ topic: 'Older work', instructions: '' })
    const newer = repository.threadCommands.create({ topic: 'Newer work', instructions: '' })
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 1), toFake: ['Date'] })
    const first = repository.chatCommands.addMessage({ threadId: older.id, text: 'the deploy failed on the database', sender: 'user' })
    vi.setSystemTime(Date.UTC(2026, 9, 20))
    const second = repository.chatCommands.addMessage({ threadId: newer.id, text: 'retrying the deploy', sender: 'assistant' })
    repository.chatCommands.createMarkerMessage({ threadId: newer.id, text: 'deploy summary' })
    vi.useRealTimers()

    await app.send('threads', { type: 'SEARCH_MESSAGES', query: 'deplo' }, { sender: THREADS, client: MAIN })
    const found = await app.nextEmit('threads', 'MESSAGES_FOUND')
    expect(found).toMatchObject({ query: 'deplo' })
    const results = (found as unknown as { results: Array<Record<string, unknown>> }).results
    expect(results.map((r) => r.messageId)).toEqual([second.id, first.id])
    expect(results[0]).toMatchObject({ threadId: newer.id, topic: 'Newer work', sender: 'assistant', snippet: 'retrying the deploy', marks: [[13, 19]] })
    expect(results[1]).toMatchObject({ threadId: older.id, marks: [[4, 10]], clippedStart: false, clippedEnd: false })
  })

  it('answers an empty query with nothing', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    await app.send('threads', { type: 'SEARCH_MESSAGES', query: '  ' }, { sender: THREADS, client: MAIN })
    const found = await app.nextEmit('threads', 'MESSAGES_FOUND')
    expect((found as unknown as { results: unknown[] }).results).toEqual([])
  })
})

describe('a snippet', () => {
  it('starts a little before its first mark and keeps the marks inside it, a cut one cut', () => {
    const text = `${'a'.repeat(100)} match ${'b'.repeat(300)}`
    const { snippet, marks, clippedStart, clippedEnd } = snippetOf(text, [[101, 106], [170, 400]])
    expect([clippedStart, clippedEnd]).toEqual([true, true])
    expect(snippet.slice(marks[0]![0], marks[0]![1])).toBe('match')
    expect(marks[1]![1]).toBe(snippet.length)
  })

  it('is the whole text when it is short', () => {
    expect(snippetOf('a deploy', [[2, 8]])).toEqual({ snippet: 'a deploy', marks: [[2, 8]], clippedStart: false, clippedEnd: false })
  })
})
