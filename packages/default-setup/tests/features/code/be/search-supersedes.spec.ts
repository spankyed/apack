// One search runs at a time: a search asked for while another runs stops it, and so does a cancel. The search is
// asked of the code system, which answers it over the search's folder.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { startApp } from '@apackdev/testing/harness'
import { FileSystemRepository } from '#features/code/be/services/filesystem.ts'
import type { SearchResult } from '#features/code/be/types.ts'

/** A search under way: the signal the repository was handed for it, and how to end it */
interface Running { signal: AbortSignal | undefined; finish(): void }

const dirs: string[] = []
let app: Awaited<ReturnType<typeof startApp>> | undefined

/** The code system over a folder whose searches run until the spec ends them */
async function searching() {
  const running: Running[] = []
  vi.spyOn(FileSystemRepository.prototype, 'searchFiles').mockImplementation((_options, _onProgress, _onResult, signal?: AbortSignal) =>
    new Promise<SearchResult[]>(resolve => { running.push({ signal, finish: () => resolve([]) }) }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-search-'))
  dirs.push(dir)
  app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: dir })
  await app.settle()
  const started = app
  const search = (query: string) => started.ask('code', { type: 'search.SEARCH_FILES', query, path: dir }, { client: 'c-main' })
  return { running, app: started, search }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.stop()
  app = undefined
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('the search', () => {
  it('stops the search under way when another is asked for, which is refused as superseded', async () => {
    const { running, search } = await searching()
    const first = search('first')
    const second = search('second')
    await vi.waitFor(() => expect(running).toHaveLength(2))
    expect(running.map(each => each.signal?.aborted)).toEqual([true, false])

    running[0].finish()
    expect(await first).toMatchObject({ ok: false, failure: { kind: 'superseded' } })
    running[1].finish()
    expect(await second).toEqual({ ok: true, value: { results: [], totalMatches: 0 } })
  })

  it('stops the search under way when it is cancelled', async () => {
    const { running, app, search } = await searching()
    const only = search('only')
    await vi.waitFor(() => expect(running).toHaveLength(1))
    await app.send('code', { type: 'search.CANCEL_SEARCH' })
    expect(running[0].signal?.aborted).toBe(true)
    running[0].finish()
    expect(await only).toMatchObject({ ok: false, failure: { kind: 'superseded' } })
  })

  it('can still cancel a search once the one it replaced has ended', async () => {
    const { running, app, search } = await searching()
    const first = search('first')
    void search('second')
    await vi.waitFor(() => expect(running).toHaveLength(2))
    // The replaced search winds up after the one that replaced it began
    running[0].finish()
    await first
    await app.send('code', { type: 'search.CANCEL_SEARCH' })
    expect(running[1].signal?.aborted).toBe(true)
    running[1].finish()
  })
})
