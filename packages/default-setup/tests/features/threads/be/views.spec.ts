// The threads views, and what a streamed reply costs them. A reply streams into one message, rewriting its text every
// flush of the stream writer; the chat page and the detail page list messages by id and read no message's content, so
// that message's own view is the one view the stream re-runs. The rest of what a window shows — the list, the recent
// threads, the open tab — hears nothing until the turn ends.
import { describe, expect, it } from 'vitest'
import { startApp, type TestApp, type TestView } from '@apackdev/testing/harness'
import { takeSystemErrors } from '@apackdev/sdk/testing'
import { repository } from '#generated/repository.ts'
import { write, type EARS } from '#generated/ears.ts'
import type { ChatPage, ChatStart, MessageEntity, ThreadTabView } from '#generated/types.ts'
import { chatService } from '#features/threads/be/services/chat.ts'
import { artifactService } from '#features/threads/be/services/artifact.ts'
import { createStreamWriter } from '../../../../src/content/actions/claude-code/_helpers/stream-writer.ts'

const THREADS = 'default-setup/threads'
const asked = { sender: THREADS, client: 'c-main' }

/** The view's results from here until one that is `null`: a thread gone */
async function untilGone(view: TestView<unknown>) {
  for (;;) {
    const update = await view.next()
    if (update.ok && update.value === null) return update
  }
}
const thread = (topic: string) => repository.threadCommands.create({ topic, instructions: '' }).id as EARS.EntityId
const say = (threadId: EARS.EntityId, text: string, sender: 'user' | 'assistant' = 'user') =>
  repository.chatCommands.addMessage({ threadId, text, sender }).id as EARS.EntityId

describe('a streamed reply', () => {
  it("re-runs its message's view once per flush, and no list, page or tab", async () => {
    const id = thread('Streaming')
    say(id, 'Question')
    const reply = say(id, '', 'assistant')
    const app = await startApp({ systems: ['threads'] })
    const views = {
      message: app.watchView<MessageEntity | null>('threads', 'message', { id: reply }),
      chat: app.watchView<ChatPage | null>('threads', 'chat', { threadId: id, limit: 50 }),
      detail: app.watchView('threads', 'detail', { id }),
      list: app.watchView('threads', 'list'),
      recent: app.watchView('threads', 'recent', { limit: 7, sortOrder: 'message' }),
      tab: app.watchView('threads', 'tab', { threadId: id }),
    }
    for (const view of Object.values(views)) await view.next()

    // The writer the Claude Code chat action streams with: each flush is one write of the message's text, at most one
    // per its 80 ms interval, so the message view's rate is the flush rate (measured: docs/archive/plans/live-queries.md, threads).
    // That interval is past the watch scheduler's gap, so each flush is one re-run; flushing faster than a frame would be
    // coalesced instead, which is why each flush here waits for its delivery as a window hears it, up to a frame late
    const writer = createStreamWriter({ chat: chatService } as never, reply)
    const FLUSHES = 16
    for (let flush = 0; flush < FLUSHES; flush++) {
      writer.pushImmediate('x')
      await views.message.next()
      await app.settle()
    }

    const reruns = Object.fromEntries(Object.entries(views).map(([name, view]) => [name, view.updates.length - 1]))
    expect(reruns, 'one re-run per flush, and nothing else').toEqual({ message: FLUSHES, chat: 0, detail: 0, list: 0, recent: 0, tab: 0 })
    const last = views.message.updates.at(-1)!
    expect(last.ok && last.value?.text).toBe('x'.repeat(FLUSHES))
  })
})

describe('the threads views', () => {
  it('page the chat by its last messages, queued ones last, and say whether older ones exist', async () => {
    const id = thread('Paged')
    const ids = ['one', 'two', 'three'].map((text) => say(id, text))
    repository.chatCommands.updateMessageState({ messageId: ids[0], updates: { status: 'queued' } })
    const app = await startApp({ systems: ['threads'] })

    const page = await app.watchView<ChatPage | null>('threads', 'chat', { threadId: id, limit: 1 }).next()
    expect(page.ok && page.value).toMatchObject({ topic: 'Paged', messageIds: [ids[2], ids[0]], hasMore: true })
    const whole = await app.watchView<ChatPage | null>('threads', 'chat', { threadId: id, limit: 50 }).next()
    expect(whole.ok && whole.value).toMatchObject({ messageIds: [ids[1], ids[2], ids[0]], hasMore: false })
  })

  it("give a new message to the open thread's page, and end a deleted thread's page, tab and detail with null", async () => {
    const id = thread('Doomed')
    const app = await startApp({ systems: ['threads'] })
    const chat = app.watchView<ChatPage | null>('threads', 'chat', { threadId: id, limit: 50 })
    const tab = app.watchView<ThreadTabView | null>('threads', 'tab', { threadId: id })
    const detail = app.watchView('threads', 'detail', { id })
    await chat.next(); await tab.next(); await detail.next()

    const message = say(id, 'Hello')
    expect(await chat.next()).toMatchObject({ ok: true, value: { messageIds: [message] } })

    artifactService.create({ artifactType: 'todo', title: 'Tasks', content: {}, threadId: id })
    expect(await tab.next()).toMatchObject({ ok: true, value: { artifacts: [expect.objectContaining({ title: 'Tasks' })] } })

    await app.send('threads', { type: 'DELETE_THREAD', threadId: id })
    for (const view of [chat, tab, detail]) await untilGone(view as TestView<unknown>)
  })
})

describe('what a window asks the threads system', () => {
  async function connected(): Promise<TestApp> {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    return app
  }

  it('answers what its chat starts from: the thread to open, the tabs every window opens, the settings', async () => {
    const pinned = thread('Pinned')
    write(pinned).set('pinned', true)
    const app = await connected()

    const call = await app.send('threads', { type: 'GET_CHAT_START' }, asked)
    const { data } = await app.nextEmit('threads', 'CHAT_STARTED', { answering: call }) as unknown as { data: ChatStart }
    expect(data.currentThreadId).toBe(pinned)
    expect(data.tabs).toEqual([{ id: pinned, label: 'Pinned', pinned: true }])
    expect(data.settings).toHaveProperty('chat')
  })

  it('answers each write, the thread it made, a landed one and a refused one, and runs one nobody asked for', async () => {
    const app = await connected()

    const created = await app.send('threads', { type: 'CREATE_THREAD', topic: 'Made', instructions: '' }, asked)
    const { id } = await app.nextEmit('threads', 'THREAD_CREATED', { answering: created }) as unknown as { id: EARS.EntityId }
    expect(repository.threadQueries.byId(id)?.topic).toBe('Made')

    const landed = await app.send('threads', { type: 'UPDATE_THREAD_FIELD', threadId: id, key: 'topic', value: 'Renamed' }, asked)
    await app.nextEmit('threads', 'THREAD_WRITTEN', { answering: landed })
    const refused = await app.send('threads', { type: 'UPDATE_THREAD_FIELD', threadId: 'Thread-missing', key: 'topic', value: 'Nothing' }, asked)
    expect(await app.nextEmit('threads', 'THREAD_WRITE_FAILED', { answering: refused })).toMatchObject({ error: expect.stringContaining('Thread-missing') })
    expect(takeSystemErrors(), 'and reported, as every thread operation that fails is').toHaveLength(1)

    await app.send('threads', { type: 'UPDATE_THREAD_FIELD', threadId: id, key: 'topic', value: 'Renamed by nobody' })
    expect(repository.threadQueries.byId(id)?.topic).toBe('Renamed by nobody')
  })
})
