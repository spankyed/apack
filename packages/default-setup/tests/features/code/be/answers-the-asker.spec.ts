// A code result reaches the window that asked for it, and only a result nobody asked for — the git watcher's refresh,
// an action's — reaches every window. Reading a file is the commonest ask the code surface makes; with the answer on
// a broadcast, one window opening a file put its contents in every window's editor.
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

it('answers a file read to the window that asked, and an unasked one to every window', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-answers-'))
  dirs.push(dir)
  const file = path.join(dir, 'notes.md')
  fs.writeFileSync(file, 'hello')
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: dir })
  await app.settle()

  const sent: Array<{ type: string; client?: string }> = []
  // The unasked read answers when its file read settles, which no settling of the bus waits for
  let everyWindow!: () => void
  const toEveryWindow = new Promise<void>((resolve) => { everyWindow = resolve })
  const stop = testRootEvents.onSurfaceSend((message) => {
    if (message.to !== CODE || message.event.type !== 'explorer.FILE_CONTENT') return
    sent.push({ type: message.event.type, client: message.client })
    if (message.client === undefined) everyWindow()
  })
  try {
    const call = await app.send('code', { type: 'explorer.READ_FILE', path: file }, { sender: CODE, client: MAIN })
    expect(await app.nextEmit('code', 'explorer.FILE_CONTENT', { answering: call })).toMatchObject({ data: expect.objectContaining({ content: 'hello' }) })
    await app.send('code', { type: 'explorer.READ_FILE', path: file })
    await toEveryWindow
    expect(sent.map((message) => message.client), 'the asker alone, then every window for nobody').toEqual([MAIN, undefined])
  } finally { stop() }
})
