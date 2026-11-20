// A code answer reaches the window that asked for it and no other; what every window hears is news with no listing on
// it. Reading a file is the commonest ask the code surface makes; with the answer on a broadcast, one window opening a
// file put its contents in every window's editor.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { testRootEvents } from '@apackdev/sdk/testing'
import { startApp } from '@apackdev/testing/harness'

const CODE = 'default-setup/code'
const MAIN = 'c-main'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

it('answers a file read to the window that asked, and to no other', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-answers-'))
  dirs.push(dir)
  const file = path.join(dir, 'notes.md')
  fs.writeFileSync(file, 'hello')
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: dir })
  await app.settle()

  const sent: Array<{ type: string; client?: string }> = []
  const stop = testRootEvents.onSurfaceSend((message) => {
    if (message.event.type === 'ASK_ANSWERED' || message.event.type === 'explorer.FILE_CHANGED_EXTERNALLY') sent.push({ type: message.event.type, client: message.client })
  })
  try {
    expect(await app.ask('code', { type: 'explorer.READ_FILE', path: file }, { client: MAIN })).toMatchObject({ ok: true, value: expect.objectContaining({ content: 'hello' }) })
    expect(sent, 'the asker alone').toEqual([{ type: 'ASK_ANSWERED', client: MAIN }])
  } finally { stop() }
})

it("answers what a window's code surface starts from to it alone, and sends every window only news of a move", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-start-'))
  dirs.push(dir)
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  const sent: Array<{ type: string; client?: string }> = []
  const stop = testRootEvents.onSurfaceSend((message) => {
    // The answer is addressed to whoever asked, which in a spec is the harness rather than the surface
    if (message.to === CODE || message.event.type === 'ASK_ANSWERED') sent.push({ type: message.event.type, client: message.client })
  })
  try {
    await app.send('code', { type: 'SET_BASE_DIRECTORY', path: dir })
    await app.send('code', { type: 'SEND_STATE' })
    await app.settle()
    expect(sent, 'a move is news, with no listing on it, and publishing sends nothing').toEqual([{ type: 'BASE_DIRECTORY_CHANGED', client: undefined }])

    sent.length = 0
    expect(await app.ask('code', { type: 'GET_CODE_START' }, { client: MAIN })).toMatchObject({ ok: true, value: { baseDirectory: dir } })
    expect(sent, 'the directory, to the asker alone').toEqual([{ type: 'ASK_ANSWERED', client: MAIN }])
  } finally { stop() }
})
