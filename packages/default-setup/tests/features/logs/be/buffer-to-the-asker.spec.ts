// The logs buffer reaches the window that asks for it — as it starts, and when the settings that filter it change —
// and no other: a window's log view is that window's. Each entry as it is logged is a feed for every window, and a
// clear is news.
import { expect, it } from 'vitest'
import { testRootEvents } from '@apackdev/sdk/testing'
import { startApp } from '@apackdev/testing/harness'
import { createLogger } from '@apackdev/sdk/logger'

const LOGS = 'default-setup/logs'
const MAIN = 'c-main'

it('answers the buffer to the window that asked, and broadcasts only each entry and a clear', async () => {
  const app = await startApp({ systems: ['logs'] })
  await app.connect()
  const sent: Array<{ type: string; client?: string }> = []
  const stop = testRootEvents.onSurfaceSend((message) => {
    if (message.to === LOGS) sent.push({ type: message.event.type, client: message.client })
  })
  try {
    createLogger('buffer-spec').info('logged once')
    await app.settle()
    const call = await app.send('logs', { type: 'GET_LOGS' }, { sender: LOGS, client: MAIN })
    const read = await app.nextEmit('logs', 'LOGS_READ', { answering: call }) as unknown as { logs: Array<{ message: string }> }
    expect(read.logs.map((log) => log.message)).toContain('logged once')
    await app.send('logs', { type: 'SEND_STATE' })
    await app.send('logs', { type: 'CLEAR_LOGS' })
    await app.settle()

    expect(sent.filter((message) => message.type === 'LOGS_READ').map((message) => message.client), 'the asker alone').toEqual([MAIN])
    const broadcast = new Set(sent.filter((message) => message.client === undefined).map((message) => message.type))
    expect([...broadcast].sort(), 'every window hears the feed and the clear, and no buffer').toEqual(['LOGS_CLEARED', 'LOG_ADDED'])
  } finally { stop() }
})
