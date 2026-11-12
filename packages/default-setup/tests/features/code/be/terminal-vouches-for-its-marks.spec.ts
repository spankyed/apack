// A terminal's shell is started with a key for its marks, and the host with the same one.
//
// What a shell reports of its commands is worth acting on only where nothing else could have reported it:
// anything that prints can print a mark. So where a hook is arranged that vouches for its marks, the
// session is opened with a key the hook reads from the shell's environment and the host is given beside
// it, and the host then believes no mark without it. The host's service is stood in for, so what is pinned
// here is what the app decides: that the two are given the same key, that every shell has one of its own,
// and that a shell with no hook to carry one is given none — where the host would otherwise wait for
// marks that never come.
import { afterEach, describe, expect, it } from 'vitest'
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { featureSettings } from '#generated/settings.ts'
import { MARKS_KEY_VARIABLE } from '#features/code/be/services/shell-integration.ts'

const HANDLERS = { onEvent: () => {}, onExit: () => {}, onCrashed: () => {} }

async function started() {
  mockService('filesystem', { writeFile: async () => {}, remove: async () => {} })
  const broker = recordingBroker({ pidBase: 9000 })
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const { terminalService } = await import('#features/code/be/services/terminal.ts')
  return { app, broker, terminalService }
}

afterEach(() => { resetTestData() })

// bash, where this machine starts it: a shell whose hook carries a key. Not claimed of Windows, where the
// shell a terminal falls back to may be cmd, whose hook has no language to carry one
describe.skipIf(process.platform === 'win32')('a terminal whose shell has a hook that vouches for its marks', () => {
  it('is opened with a key of its own, which its shell is given and the host is given', async () => {
    const { app, broker, terminalService } = await started()
    await terminalService.create({ cols: 80, rows: 24, shell: '/bin/bash' }, HANDLERS)
    await terminalService.create({ cols: 80, rows: 24, shell: '/bin/bash' }, HANDLERS)

    const keys = broker.opened.map(({ options }) => options.marksKey)
    expect(keys).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/), expect.stringMatching(/^[0-9a-f]{32}$/)])
    expect(keys[0], 'two shells were given one key').not.toBe(keys[1])
    for (const { options } of broker.opened) {
      expect(options.env?.[MARKS_KEY_VARIABLE], 'the shell and the host were given different keys').toBe(options.marksKey)
      expect(options.args, 'the hook that reads the key was not arranged').not.toHaveLength(0)
    }
    await app.stop()
  })

  it('is given a new key when its shell is started again', async () => {
    const { app, broker, terminalService } = await started()
    const terminal = await terminalService.create({ cols: 80, rows: 24, shell: '/bin/bash' }, HANDLERS)
    broker.endShell(broker.opened[0]!.id, 1)
    await terminalService.restart(terminal.id, HANDLERS)

    expect(broker.opened).toHaveLength(2)
    expect(broker.opened[1]!.options.marksKey).toMatch(/^[0-9a-f]{32}$/)
    expect(broker.opened[1]!.options.marksKey, 'a shell was started with the key of the one before it')
      .not.toBe(broker.opened[0]!.options.marksKey)
    await app.stop()
  })
})

describe('a terminal whose shell has no such hook', () => {
  it('is opened with no key when shell integration is switched off', async () => {
    const { app, broker, terminalService } = await started()
    featureSettings.forFeature('code').set({ path: ['enableShellIntegration'], value: false })
    await terminalService.create({ cols: 80, rows: 24, shell: '/bin/bash' }, HANDLERS)

    const asked = broker.opened[0]!.options
    expect(asked.marksKey, 'the host was told to wait for marks nothing will print').toBeUndefined()
    expect(asked.env?.[MARKS_KEY_VARIABLE]).toBeUndefined()
    await app.stop()
  })
})
