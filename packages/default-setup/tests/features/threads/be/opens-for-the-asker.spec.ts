// Opening a thread reaches the window that opened it, and only a flow's reaches every window.
//
// A window opening a thread shows it already: what the system does is mark it visited, and every window's recent
// list follows through its view. So it answers nothing. The thread a window's first message starts, or a fork, is the
// system's to name, and it names it to that window alone (`SHOW_THREAD`); a thread a flow opens has no window to
// answer, so every window is told. Put the window's answer back on a broadcast and the first case here fails.
import { beforeEach, describe, expect, it } from 'vitest'
import { testRootEvents } from '@apackdev/sdk/testing'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { chatService } from '#features/threads/be/services/chat.ts'

const THREADS = 'default-setup/threads'
/** The connection an ask arrived on, which is what makes it a window's rather than an action's */
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
  it('shows the thread a first message started to the window that sent it, and no other', async () => {
    const app = await startApp({ systems: ['threads'] })
    await app.connect()

    await app.send('threads', { type: 'USER_MSG', text: 'Start something' }, { sender: THREADS, client: MAIN })
    await app.nextEmit('threads', 'SHOW_THREAD')
    await app.settle()

    expect(clientsFor('SHOW_THREAD'), 'one connection, not every window').toEqual([MAIN])
  })

  /**
   * The fallback, and why it is reply-*or*-broadcast rather than a bare `reply?.()`: a thread a flow opens —
   * onboarding, a session restore, a summarise — has no window waiting on it, and every window should follow.
   */
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

    await app.send('threads', { type: 'OPEN_THREAD_CHAT', threadId: older }, { sender: THREADS, client: MAIN })
    expect(topics(await recent.next())[0], 'the visited thread first, in every window').toBe('Older')
    await app.settle()
    expect(sent, 'and nothing sent back').toEqual([])
  })
})
