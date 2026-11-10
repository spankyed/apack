// A terminal on a target: somewhere other than this machine, named in the code settings by the command
// that reaches it.
//
// The host's service is stood in for, so what is pinned here is what the app decides: that the target's
// command is handed over as the arguments it is, that nothing of this machine's — a shell, a directory, a
// startup file, a recording — is asked of the far side, and that a target which is not there is refused
// rather than quietly becoming a shell here.
import { afterEach, describe, expect, it } from 'vitest'
import { mockService, resetTestData, startApp, takeSystemErrors } from '@apackdev/testing/harness'
import { recordingBroker } from './_support/terminal-broker.ts'
import { featureSettings } from '#generated/settings.ts'
import { repository } from '#generated/repository.ts'
import { EARS, newId } from '#generated/ears.ts'
import { commandArguments } from '#features/code/be/services/terminal.ts'
import type { TerminalInfo } from '#features/code/be/types.ts'

const CODE = 'default-setup/code'
const WINDOW = 'c-main'
const DEVBOX = { id: 'tt_devbox', label: 'devbox', command: 'ssh -p 2222 "dev box" apack-terminal proxy /tmp/t.sock' }
const DEVBOX_ARGV = ['ssh', '-p', '2222', 'dev box', 'apack-terminal', 'proxy', '/tmp/t.sock']

async function started() {
  const written: string[] = []
  mockService('filesystem', { writeFile: async (file: string) => { written.push(file) }, remove: async () => {} })
  const broker = recordingBroker({ pidBase: 8000 })
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  featureSettings.forFeature('code').set({ path: ['terminalTargets'], value: [DEVBOX] })
  return { app, broker, written }
}

afterEach(() => { resetTestData() })

describe('a terminal on a target', () => {
  it("is opened through the target's command, with nothing of this machine's asked of it", async () => {
    const { app, broker, written } = await started()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', target: DEVBOX.id, cwd: '/Users/me/project' }, { sender: CODE, client: WINDOW })
    const opened = (await app.nextEmit('code', 'terminal.OPENED')).data as TerminalInfo
    await app.settle()

    expect(broker.opened.map(({ target }) => target)).toEqual([DEVBOX_ARGV])
    const asked = broker.opened[0]!.options
    expect(asked, 'a path on this machine was handed to another')
      .toEqual({ cols: 80, rows: 24, colors: expect.anything(), images: true })
    expect(written, 'a startup file was written for a shell that cannot read it').toEqual([])
    expect(opened).toMatchObject({ title: 'devbox', target: { id: DEVBOX.id, label: 'devbox', key: `key:${DEVBOX_ARGV.join(' ')}` } })
    expect(repository.terminalQueries.byId(opened.id)?.target).toBe(DEVBOX.id)
    await app.stop()
  })

  it('is refused when the settings name no such target, and no shell is started here in its place', async () => {
    const { app, broker } = await started()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', target: 'tt_gone' }, { sender: CODE, client: WINDOW })
    expect((await app.nextEmit('code', 'terminal.ERROR')).data).toMatchObject({ message: expect.stringContaining('tt_gone') })
    expect(takeSystemErrors()).toHaveLength(1)
    expect(broker.opened).toEqual([])
    await app.stop()
  })

  it('comes back on its target at the next start, and is closed when the target has left the settings', async () => {
    const { app, broker } = await started()
    const row = (target: string) => {
      const id = newId(EARS.Entity.Terminal)
      repository.terminalCommands.create({ id, title: 'from before', shell: '', cwd: '', cols: 80, rows: 24, target })
      return id
    }
    const [there, gone] = [row(DEVBOX.id), row('tt_gone')]

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll({ onEvent: () => {}, onExit: () => {}, onCrashed: () => {} })

    expect(broker.opened.map(({ target }) => target), 'a terminal that ran elsewhere was started on this machine')
      .toEqual([DEVBOX_ARGV])
    const listed = terminalService.list()
    expect(listed.find(({ id }) => id === there)?.target?.label).toBe('devbox')
    expect(listed.find(({ id }) => id === gone)).toBeUndefined()
    await app.stop()
  })
})

describe("a target's command", () => {
  it('is the arguments it would be in a shell, and is never given to one', () => {
    expect(commandArguments(DEVBOX.command)).toEqual(DEVBOX_ARGV)
    expect(commandArguments(`docker exec -i 'my box' sh -c "echo \\"hi\\" there"`))
      .toEqual(['docker', 'exec', '-i', 'my box', 'sh', '-c', 'echo "hi" there'])
    expect(commandArguments('a\\ b  c ""')).toEqual(['a b', 'c', ''])
    // What a shell would act on is one more character of an argument here
    expect(commandArguments('ssh host; rm -rf ~ $(id) | cat')).toEqual(['ssh', 'host;', 'rm', '-rf', '~', '$(id)', '|', 'cat'])
    expect(commandArguments('   ')).toEqual([])
  })
})
