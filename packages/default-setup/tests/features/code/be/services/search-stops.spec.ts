import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileWhileWorking } from '@apackdev/sdk/progress'
import { FileSystemRepository } from '#features/code/be/services/filesystem.ts'

let dir: string
/** This spec's own hold on the pipe, which is what keeps ripgrep reading: closing it is the end of its input */
let held: number | undefined
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-stops-')) })
afterEach(() => {
  // A ripgrep nothing stopped reads the end of its input here and exits, so none is left behind whatever the case made of it
  if (held !== undefined) fs.closeSync(held)
  held = undefined
  fs.rmSync(dir, { recursive: true, force: true })
})

// A named pipe is what makes a search that cannot finish: Windows has none to make
it.skipIf(process.platform === 'win32')('ends ripgrep when the search is stopped, and answers with why', async () => {
  const pipe = path.join(dir, 'never-ends')
  await execFileWhileWorking('mkfifo', [pipe])
  // Open for writing too, so ripgrep's read has a writer and no end: it searches for as long as it is left to
  held = fs.openSync(pipe, 'r+')

  const stopping = new AbortController()
  const search = new FileSystemRepository(dir).searchFiles({ query: 'needle', path: pipe }, undefined, undefined, stopping.signal)
  const reason = new Error('superseded')
  stopping.abort(reason)

  // Settles at all only because ripgrep exited: nothing else ends its read
  await expect(search).rejects.toBe(reason)
})
