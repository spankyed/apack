// A terminal whose shell integration cannot be written still opens — and that matters because the setting
// that arranges it is now **on by default**.
//
// Before F14 closed, this path was unreachable for everybody: the one line that ever wrote
// `enableShellIntegration` wrote `false`, so nothing wrote an rc file and nothing could fail to. Turning the
// capability on is what makes "the data dir is read-only, the disk is full, the write was refused" a thing
// a user can hit on an ordinary terminal open.
//
// The trade is stated in the code and asserted here: a shell that starts without its hook is a terminal that
// does not follow `cd`; a shell that does not start is not a terminal. So the write failing must cost the
// facts and nothing else.
import { describe, expect, it } from 'vitest'
import { mockService, resetTestData, startApp } from '@apackdev/testing/harness'

/** What the host's terminal service was asked to start, including how the shell was to be launched */
function recordingSessions() {
  const opened: Array<{ args?: readonly string[]; env?: Readonly<Record<string, string>> }> = []
  let next = 0
  mockService('terminal', {
    open: async (options) => {
      opened.push({ args: options.args, env: options.env })
      next += 1
      return {
        id: `broker-${next}`,
        pid: 3000 + next,
        write: async () => {},
        resize: async () => {},
        terminate: async () => {},
      }
    },
  })
  return opened
}

describe('a shell whose integration could not be written', () => {
  it('still starts, carrying no arrangement', async () => {
    const opened = recordingSessions()
    mockService('filesystem', {
      writeFile: async () => { throw new Error('read-only file system') },
    })
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    const terminal = await terminalService.create({ cols: 80, rows: 24 }, { onData: () => {}, onExit: () => {}, onCrashed: () => {} })

    expect(terminal.id, 'the terminal opened').toBeTruthy()
    expect(opened, 'the shell was started').toHaveLength(1)
    // Not "the arrangement it would have had": a hook pointing at a file that was never written is worse
    // than none, since the shell would fail to start reading it
    expect(opened[0]!.args, 'no launch arguments, because the file they name is not there').toBeUndefined()
    expect(opened[0]!.env, 'and nothing pointed at the directory').toBeUndefined()

    await app.stop()
    resetTestData()
  })

  it('starts with its arrangement when the write succeeds', async () => {
    // The refusal has to be about the failure and not about this path: the same open with a working
    // filesystem must carry the arrangement, or the case above would pass with the feature switched off
    const opened = recordingSessions()
    const written: string[] = []
    mockService('filesystem', {
      writeFile: async (file: string) => { written.push(file) },
    })
    const app = await startApp({ systems: ['code'] })
    await app.connect()

    const { terminalService } = await import('#features/code/be/services/terminal.ts')
    await terminalService.create({ cols: 80, rows: 24 }, { onData: () => {}, onExit: () => {}, onCrashed: () => {} })

    expect(written, 'the rc file was written').not.toHaveLength(0)
    const arranged = (opened[0]!.args?.length ?? 0) > 0 || Object.keys(opened[0]!.env ?? {}).length > 0
    expect(arranged, 'and the shell was told how to read it').toBe(true)

    await app.stop()
    resetTestData()
  })
})
