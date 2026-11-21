// A thread that was started is news every window hears; a thread a window opens is that window's alone.
//
// A window opening a thread shows it already: what the system does is mark it visited, and every window's recent
// list follows through its view. The thread a first message starts, a fork, and a thread a flow opens are the
// system's to name, and it tells every window (`SHOW_THREAD`) whoever asked — the system does not learn whether a
// window did. The window that sent the message is answered with the thread as well, which is its answer and not the
// news.
import { beforeEach, describe, expect, it } from 'vitest'
import { testRootEvents } from '@apackdev/sdk/testing'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { chatService } from '#features/threads/be/services/chat.ts'

const THREADS = 'default-setup/threads'
/** The connection a window's ask arrives on */
const MAIN = 'c-main'

/**
 * Every message the bus carried to a surface, with the connection it was addressed to.
 *
 * `app.emitted()` hands back the events alone, and the whole subject here is `Message.client` — a broadcast
 * and an answer are the same event and differ only in where they went.
 */
let sent: Array<{ type: string; client?: string }>
let stop: () => void

beforeEach(() => {
  sent = []
  stop?.()
  stop = testRootEvents.onSurfaceSend((message) => {
    if (message.to === THREADS) sent.push({ type: message.event.type, client: message.client })
  })
})

const clientsFor = (type: string) => sent.filter((m) => m.type === type).map((m) => m.client)

describe('opening a thread', () => {
  it('answers the window whose first message started a thread, and tells no other window to show it', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()

    expect(await app.ask('threads', { type: 'USER_MSG', text: 'Start something' }, { client: MAIN }))
      .toMatchObject({ ok: true, value: { started: true, threadId: expect.any(String) } })
    await app.settle()

    expect(clientsFor('SHOW_THREAD'), 'the asker opens it from its answer').toEqual([])
  })

  it('shows no window a thread for a message sent to one that exists', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    const { id } = repository.threadCommands.create({ topic: 'Under way', instructions: '' })

    expect(await app.ask('threads', { type: 'USER_MSG', text: 'More', threadId: id }, { client: MAIN }))
      .toMatchObject({ ok: true, value: { started: false, threadId: id } })
    await app.settle()

    expect(clientsFor('SHOW_THREAD')).toEqual([])
  })

  it('shows every window the thread a message nobody asked about started', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()

    await app.send('threads', { type: 'USER_MSG', text: 'Sent by a flow' })
    await app.nextEmit('threads', 'SHOW_THREAD')
    await app.settle()

    expect(clientsFor('SHOW_THREAD'), 'absent means every connection').toEqual([undefined])
  })

  /** A thread a flow opens — onboarding, a session restore, a summarise — which every window should follow */
  it('shows a thread a flow opens to every window', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    const { id } = repository.threadCommands.create({ topic: 'Opened by an action', instructions: '' })

    chatService.showThread(id)
    await app.nextEmit('threads', 'SHOW_THREAD')
    await app.settle()

    expect(clientsFor('SHOW_THREAD'), 'absent means every connection').toEqual([undefined])
  })

  it("answers nothing to a window that opened one itself, and every window's recent list follows the visit", async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()
    const older = repository.threadCommands.create({ topic: 'Older', instructions: '' }).id
    repository.threadCommands.create({ topic: 'Newer', instructions: '' })
    repository.threadCommands.markAsVisited(repository.threadQueries.all().find((t) => t.topic === 'Newer')!.id)
    const recent = app.watchView<Array<{ topic: string }>>('threads', 'recent', { limit: 7, sortOrder: 'visited' })
    const topics = (update: { ok: boolean; value?: unknown }) => (update.value as Array<{ topic: string }>).map((t) => t.topic)
    expect(topics(await recent.next())[0]).toBe('Newer')

    expect(await app.ask('threads', { type: 'OPEN_THREAD_CHAT', threadId: older }, { client: MAIN })).toEqual({ ok: true, value: undefined })
    expect(topics(await recent.next())[0], 'the visited thread first, in every window').toBe('Older')
    await app.settle()
    expect(sent, 'and nothing sent to any window').toEqual([])
  })
})
