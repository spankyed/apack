// Where a terminal's shell is, asked of the broker rather than parsed a second time — X5.
//
// **The markers are read where the bytes arrive.** The broker scans every byte of the pty's output for
// OSC 7, 633 and 1337 and holds what it read; asking it is one request over a socket the app already has
// open. The app scanned the same bytes again with its own patterns over the highest-frequency feed it has,
// and that copy could not see a sequence split across two reads, which is exactly what a prompt hook
// writing a long path produces.
//
// What the broker answers is decoded but not shaped: an OSC 7 URL gives `/C:/Users/...`, which nothing on
// Windows can open. So the platform reader stays — over the authority's value instead of a second capture.
import { describe, expect, it, vi } from 'vitest'
import { resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'

const handlers = () => ({ onData: vi.fn(), onExit: vi.fn(), onCrashed: vi.fn() })

async function aTerminal() {
  const broker = recordingBroker({ pidBase: 7000 })
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const { terminalService } = await import('#features/code/be/services/terminal.ts')
  const info = await terminalService.create({ cols: 80, rows: 24 }, handlers())
  return { broker, app, terminalService, info }
}

describe('where a terminal says its shell is', () => {
  it('is what the broker read, shaped for the platform the path names', async () => {
    const { broker, app, terminalService, info } = await aTerminal()

    broker.reportsCwd('broker-1', '/C:/Users/someone/my project')

    expect(await terminalService.reportedCwd(info.id)).toBe('C:\\Users\\someone\\my project')
    await app.stop()
    resetTestData()
  })

  it('is nothing while the shell has reported none, rather than a guess', async () => {
    const { app, terminalService, info } = await aTerminal()

    expect(await terminalService.reportedCwd(info.id)).toBeUndefined()
    await app.stop()
    resetTestData()
  })

  it('is nothing for a terminal with no shell running, which is not an error', async () => {
    const { broker, app, terminalService, info } = await aTerminal()
    broker.reportsCwd('broker-1', '/Users/someone/work')

    broker.endShell('broker-1', 1)

    // The terminal is still there — a crash keeps it — and it has no session to ask
    expect(await terminalService.reportedCwd(info.id)).toBeUndefined()
    await app.stop()
    resetTestData()
  })
})
