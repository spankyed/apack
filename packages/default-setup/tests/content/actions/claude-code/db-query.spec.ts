// The query a flow generates reaches the window that asked for it, and no other. A flow run is no delivery, so it has
// no sender to reply to: the database system puts the asking window's connection in the brain event, the flow hands
// it to the action, and the action answers that connection. An ask no window made has nobody to tell.
import { describe, expect, it, vi } from 'vitest'
import { onIncoming } from '@apackdev/sdk/events'
import { startApp } from '@apackdev/testing/harness'
import { action } from '../../../../src/content/actions/claude-code/db-query.ts'

/** The services the action reaches, with the window's sends recorded */
function services() {
  const sent: Array<{ client: string; surface: string; type: string }> = []
  return {
    sent,
    services: {
      emitter: { sendToWindow: (client: string, surface: string, event: { type: string }) => { sent.push({ client, surface, type: event.type }) } },
      database: { buildQueryContext: () => ({ schema: '', topology: '' }) },
      prompt: { usePrompt: () => 'system prompt' },
      cli: { claudeCode: { exec: vi.fn(async () => ({ stdout: 'return query.all().ids()' })) } },
    } as never,
  }
}

describe('a generated query', () => {
  it('is answered to the connection the ask carried', async () => {
    const { sent, services: fakes } = services()
    await action({ prompt: 'every id', client: 'c-main' }, fakes, {} as never, 'Flow-1')
    expect(sent).toEqual([
      { client: 'c-main', surface: 'default-setup/database', type: 'AI_QUERY_LOADING' },
      { client: 'c-main', surface: 'default-setup/database', type: 'AI_QUERY_GENERATED' },
    ])
  })

  it('tells nobody, and asks no model, when no window asked', async () => {
    const { sent, services: fakes } = services()
    expect(await action({ prompt: 'every id' }, fakes, {} as never, 'Flow-1')).toMatchObject({ success: false })
    expect(sent).toEqual([])
  })

  it("is asked for with the asking window's connection in the brain event", async () => {
    const app = await startApp({ systems: ['database'] })
    await app.connect()
    const toBrain: Array<{ payload?: { client?: string } }> = []
    const stop = onIncoming((message) => {
      if (message.event.type === 'HANDLE_BRAIN_EVENT') toBrain.push(message.event as never)
    })
    try {
      await app.send('database', { type: 'GENERATE_AI_QUERY', prompt: 'every id' }, { sender: 'default-setup/database', client: 'c-main' })
      await app.settle()
      expect(toBrain.map((event) => event.payload?.client)).toEqual(['c-main'])
    } finally { stop() }
  })
})
