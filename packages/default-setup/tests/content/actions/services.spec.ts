// A content action run by the action step reaches the app through `services`: it sends through services.emitter, logs
// through services.logger and writes through services.repository, all on the runtime the harness binds
import { expect, it, vi } from 'vitest'
import { mockService, startApp } from '@apackdev/testing/harness'
import { testRootEvents } from '@apackdev/sdk/testing'
import type { LogEvent } from '@apackdev/sdk/logger'
import type { EARS } from '@apackdev/sdk'
import { repository } from '#generated/repository.ts'
import type { Services } from '#generated/services.ts'
import { actionLabel, writeDefaultFlows } from '../../_support/flows.ts'

it("pauses a running Claude Code turn: CC: Pause Turn's log entry and thread row", async () => {
  writeDefaultFlows()
  // No CLI process runs in the test
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: () => undefined, getHandle: () => undefined, isConversationBusy: () => false, clearHandle: vi.fn() } } as never)
  mockService<Services, 'threads'>('threads', { updateChatState: vi.fn() })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const { id } = repository.threadCommands.create({ topic: 'A running turn', instructions: '' })
  const threadId = id as EARS.EntityId
  const app = await startApp({ systems: ['brain'] })
  await app.connect()
  // The Claude Code flow's entry track clears run state left over from a previous process: the turn starts after it
  await app.runFlow('Claude Code')
  repository.threadCommands.update(threadId, { context: { claudeCode: { sessionId: 'session-1', isRunning: true } } })

  const logs: LogEvent[] = []
  const stopLogs = testRootEvents.onLog((event) => { logs.push(event) })
  const run = await app.runFlow('Claude Code', { event: 'user.thread.pause', data: { threadId } }).finally(stopLogs)

  expect(run.steps.map((step) => [actionLabel(step), step.status])).toEqual([['CC: Pause Turn', 'completed']])
  expect(logs).toContainEqual(expect.objectContaining({
    level: 'info',
    source: 'action:CC: Pause Turn',
  }))
  const thread = repository.threadQueries.byId(threadId) as { context?: { claudeCode?: Record<string, unknown> } }
  expect(thread.context?.claudeCode).toMatchObject({ sessionId: 'session-1', isRunning: false })
})
