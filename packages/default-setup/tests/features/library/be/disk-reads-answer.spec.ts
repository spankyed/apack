// What is under a symlinked folder is on disk, where a read can fail for reasons no row describes: the file was
// deleted while the library still listed it, the folder cannot be read. The window that asked is answered either
// way, since it shows nothing until it is.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

const WINDOW = { client: 'c-main' }

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // Readable again, or it cannot be removed
    fs.chmodSync(dir, 0o700)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** A folder on disk that the library shows as a symlinked folder: where it is, and the folder's id */
function symlinkedFolder(): { dir: string; folderId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-disk-'))
  dirs.push(dir)
  return { dir, folderId: repository.libraryCommands.createSymlinkCollection('On disk', dir).id }
}

it('answers the window that asked for a file that is no longer on disk', async () => {
  const app = await startApp({ systems: ['library'] })
  await app.connect()
  const { folderId } = symlinkedFolder()
  expect(await app.ask('library', { type: 'GET_DOCUMENT', id: `symlink:${folderId}/deleted.md` }, WINDOW))
    .toMatchObject({ ok: false, failure: { kind: 'not-found', message: expect.stringContaining('deleted.md') } })
})

// A folder nobody may read is not one for the user that owns everything, and Windows has no such mode
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('answers the window that asked for a folder it cannot read', async () => {
  const app = await startApp({ systems: ['library'] })
  await app.connect()
  const { dir, folderId } = symlinkedFolder()
  fs.chmodSync(dir, 0o000)
  expect(await app.ask('library', { type: 'GET_FOLDER_CONTENTS', folderId }, WINDOW))
    .toMatchObject({ ok: false, failure: { kind: 'no-access', message: expect.stringContaining('EACCES') } })
})
