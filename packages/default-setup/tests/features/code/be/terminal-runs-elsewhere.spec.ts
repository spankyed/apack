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

  const HANDLERS = { onEvent: () => {}, onExit: () => {}, onCrashed: () => {} }
  const rowOn = (target: string, session?: string) => {
    const id = newId(EARS.Entity.Terminal)
    repository.terminalCommands.create({ id, title: 'from before', shell: '', cwd: '', cols: 80, rows: 24, target, ...(session && { session }) })
    return id
  }

  it("comes back at the next start without its target's command being run, and is closed when the target has left the settings", async () => {
    const { app, broker } = await started()
    const [there, gone] = [rowOn(DEVBOX.id), rowOn('tt_gone')]

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(HANDLERS)

    // A row and a setting are data: starting the app is not what runs a command either of them names
    expect(broker.opened, 'a target was reached by the app starting').toEqual([])
    expect(broker.adopted).toEqual([])
    const listed = terminalService.list()
    expect(listed.find(({ id }) => id === there)).toMatchObject({
      active: false, target: { id: DEVBOX.id, label: 'devbox' }, exited: { code: null, unreached: true },
    })
    expect(listed.find(({ id }) => id === gone)).toBeUndefined()
    await app.stop()
  })

  it('takes up the shell it had on the target when it is started again, where the target still has it', async () => {
    const { app, broker } = await started()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', target: DEVBOX.id }, { sender: CODE, client: WINDOW })
    const opened = (await app.nextEmit('code', 'terminal.OPENED')).data as TerminalInfo
    await app.settle()
    const { terminalService } = await import('#features/code/be/services/terminal.ts')

    // The app starts again with the target's shell still running there
    const there = rowOn(DEVBOX.id, opened.session)
    await terminalService.restoreAll(HANDLERS)
    const restarted = await terminalService.restart(there, HANDLERS)

    expect(broker.adopted).toEqual([opened.session])
    expect(broker.opened, 'a second shell was started beside the one still running').toHaveLength(1)
    expect(restarted).toMatchObject({ active: true, session: opened.session, target: { key: `key:${DEVBOX_ARGV.join(' ')}` } })
    await app.stop()
  })

  it('starts a shell on the target when the one it had there is gone', async () => {
    const { app, broker } = await started()
    const there = rowOn(DEVBOX.id, 'broker-ended-long-ago')
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(HANDLERS)

    const restarted = await terminalService.restart(there, HANDLERS)

    expect(broker.opened.map(({ target }) => target)).toEqual([DEVBOX_ARGV])
    expect(restarted).toMatchObject({ active: true, session: broker.opened[0]!.id })
    expect(repository.terminalQueries.byId(there)?.session).toBe(broker.opened[0]!.id)
    await app.stop()
  })

  it('has the shell it left on the target ended when it is closed without having been reached', async () => {
    const { app, broker } = await started()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', target: DEVBOX.id }, { sender: CODE, client: WINDOW })
    const opened = (await app.nextEmit('code', 'terminal.OPENED')).data as TerminalInfo
    await app.settle()
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    // The app starts again; the shell is still on the target and this run has not reached it
    const there = rowOn(DEVBOX.id, opened.session)
    await terminalService.restoreAll(HANDLERS)

    expect(await terminalService.kill(there, HANDLERS)).toBe('closed')

    expect(broker.terminated, 'a shell was left running on the target with nothing naming it').toContain(opened.session)
    expect(terminalService.list().find(({ id }) => id === there)).toBeUndefined()
    await app.stop()
  })

  it('says why once when its target cannot be reached, and is started when it can be', async () => {
    const { app, broker } = await started()
    const there = rowOn(DEVBOX.id, 'broker-from-before')
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(HANDLERS)

    broker.targetsUnreachable('ssh: connect to host devbox port 22: Operation timed out')
    await expect(terminalService.restart(there, HANDLERS)).rejects.toThrow(/Operation timed out/)
    // One ask of the target, not one for the shell it had and another for a new one
    expect(broker.refusedByTarget).toBe(1)
    expect(terminalService.list().find(({ id }) => id === there), 'a terminal whose target was away was closed').toBeDefined()

    broker.targetsUnreachable(undefined)
    expect(await terminalService.restart(there, HANDLERS)).toMatchObject({ active: true })
    await app.stop()
  })

  it('is started once however many times it is asked to start while it is starting', async () => {
    const { app, broker } = await started()
    const there = rowOn(DEVBOX.id)
    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.restoreAll(HANDLERS)

    const [first, second] = await Promise.all([terminalService.restart(there, HANDLERS), terminalService.restart(there, HANDLERS)])

    expect(broker.opened, 'a second shell was started under one terminal').toHaveLength(1)
    expect(second).toEqual(first)
    await app.stop()
  })

  it('is neither recorded nor looked back through, both being files on this machine', async () => {
    const { app, broker } = await started()
    await app.send('code', { type: 'terminal.CREATE_TERMINAL', target: DEVBOX.id }, { sender: CODE, client: WINDOW })
    const opened = (await app.nextEmit('code', 'terminal.OPENED')).data as TerminalInfo
    await app.settle()
    const { terminalService } = await import('#features/code/be/services/terminal.ts')

    expect(opened.recorded).toBeUndefined()
    expect(await terminalService.rewind(opened.id, { cols: 80, rows: 24 }, WINDOW)).toBeNull()
    expect(broker.rewound).toEqual([])
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
