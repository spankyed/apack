// What the specs about a terminal's program status share: a record as the host sends one, a terminal a window
// opened, and what was sent to windows and to systems.
import { afterEach } from 'vitest'
import { resetTestData, startApp, type TestApp } from '@apackdev/testing/harness'
import { testRootEvents } from '@apackdev/sdk/testing'
import type { ProgramStatusRecord } from '@apackdev/sdk/services'
import type { TerminalStatus } from '#features/code/be/types.ts'
import { recordingBroker } from './recording-broker.ts'
import { answered } from './answered.ts'

export const WINDOW = 'c-main'

/** The app the current case started, stopped and its data reset after it */
export const running: { app: TestApp | undefined } = { app: undefined }
export function stopsAfterEach(): void {
  afterEach(async () => {
    await running.app?.stop()
    running.app = undefined
    resetTestData()
  })
}

/** A record as the host sends one, working as `codex` and confirmed, but for what a case says of it */
export const record = (over: Partial<ProgramStatusRecord> = {}): ProgramStatusRecord => ({
  id: '', state: 'working', kind: null, progress: null, app: 'codex', title: null, message: null,
  changed: 1, sinceMs: 1_700_000_000_000, confirmed: 'matched', ...over,
})

/** The code system with one terminal a window opened, and the session its shell runs in */
export async function aTerminal(systems: string[] = ['code']) {
  const broker = recordingBroker()
  const app = running.app = await startApp({ systems })
  await app.connect()
  const opened = answered<{ id: string }>(await app.ask('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' }, { client: WINDOW }))
  await app.settle()
  return { app, broker, terminalId: opened.id, session: broker.opened[0]!.id }
}

/** What windows were last told of a terminal's statuses */
export const lastTold = (): { terminalId: string; statuses: TerminalStatus[] } | undefined =>
  running.app!.emitted('code').filter(event => event.type === 'terminal.STATUS').at(-1)?.data as { terminalId: string; statuses: TerminalStatus[] } | undefined

/** Every message sent to a system while `during` ran */
export async function sentToSystems(during: () => Promise<void>): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const sent: Array<{ type: string } & Record<string, unknown>> = []
  const stop = testRootEvents.onIncoming(({ event }) => { sent.push(event as { type: string }) })
  try {
    await during()
    await running.app!.settle()
  } finally {
    stop()
  }
  return sent
}
