// The code system's half of the code index: what a window asks it, answered to that window, and the index following
// the directory the surface is on.
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { codeIndexQueries } from '#features/code/be/code-index/repository.ts'

const CODE = 'default-setup/code'
const MAIN = 'c-main'

let root: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-system-')))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'a')
  fs.writeFileSync(path.join(root, 'a.ts'), '\n\nexport function target() { return 1 }\n')
  git('add', '-A')
  git('commit', '-qm', 'c')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

async function appOnDirectory() {
  const app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: root })
  await app.settle()
  return app
}

it('indexes the directory when turned on, and takes it away when turned off', async () => {
  const app = await appOnDirectory()
  await app.send('code', { type: 'codeIndex.SET_ENABLED', enabled: true })
  await vi.waitFor(() => expect(codeIndexQueries.status(root).progress).toMatchObject({ state: 'idle', symbols: 1 }))
  await app.send('code', { type: 'codeIndex.SET_ENABLED', enabled: false })
  await vi.waitFor(() => expect(codeIndexQueries.project(root)).toBeUndefined())
})

it('answers where a symbol is, at the line it is on now', async () => {
  const app = await appOnDirectory()
  await app.send('code', { type: 'codeIndex.SET_ENABLED', enabled: true })
  await vi.waitFor(() => expect(codeIndexQueries.status(root).progress).toMatchObject({ state: 'idle', symbols: 1 }))
  const [found] = codeIndexQueries.searchSymbols(root, 'target', 5)
  fs.writeFileSync(path.join(root, 'a.ts'), '\n\n\n\n\nexport function target() { return 1 }\n')
  const call = await app.send('code', { type: 'codeIndex.LOCATE', symbol: found!.id }, { sender: CODE, client: MAIN })
  expect(await app.nextEmit('code', 'codeIndex.LOCATED', { answering: call })).toMatchObject({
    data: { path: path.join(root, 'a.ts'), line: 6, column: 8 },
  })
})

it('answers a staged diff, with the index off', async () => {
  const app = await appOnDirectory()
  fs.writeFileSync(path.join(root, 'a.ts'), 'export function target() { return 2 }\n')
  git('add', '-A')
  const call = await app.send('code', { type: 'codeIndex.SEMANTIC_DIFF', range: { staged: true } }, { sender: CODE, client: MAIN })
  expect(await app.nextEmit('code', 'codeIndex.SEMANTIC_DIFF_READY', { answering: call })).toMatchObject({
    data: { changes: [{ path: 'a.ts', name: 'target', change: 'body' }], unread: [] },
  })
})
