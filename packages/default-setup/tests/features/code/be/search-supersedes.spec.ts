// A search runs for as long as whoever asked for it waits: stopping the ask stops the search, and what the search
// finds on the way reaches its asker and nobody else. The search is asked of the code system, which answers it over
// the search's folder.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { startApp } from '@apackdev/testing/harness'
import { FileSystemRepository } from '#features/code/be/services/filesystem.ts'
import type { SearchResult } from '#features/code/be/types.ts'

/** A search under way: the signal the repository was handed for it, how it reports, and how to end it */
interface Running { signal: AbortSignal | undefined; found(result: SearchResult): void; finish(): void }

const dirs: string[] = []
let app: Awaited<ReturnType<typeof startApp>> | undefined

/** The code system over a folder whose searches run until the spec ends them */
async function searching() {
  const running: Running[] = []
  vi.spyOn(FileSystemRepository.prototype, 'searchFiles').mockImplementation((_options, _onProgress, onResult, signal?: AbortSignal) =>
    new Promise<SearchResult[]>(resolve => { running.push({ signal, found: result => onResult?.(result), finish: () => resolve([]) }) }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-search-'))
  dirs.push(dir)
  app = await startApp({ systems: ['code'] })
  await app.connect()
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: dir })
  await app.settle()
  const started = app
  const search = (query: string, options: { signal?: AbortSignal; heard?: (update: unknown) => void } = {}) =>
    started.ask('code', { type: 'search.SEARCH_FILES', query, path: dir }, { client: 'c-main', ...options })
  return { running, app: started, search }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await app?.stop()
  app = undefined
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('the search', () => {
  it('stops when whoever asked for it stops waiting', async () => {
    const { running, search } = await searching()
    const stopping = new AbortController()
    const asked = search('only', { signal: stopping.signal })
    await vi.waitFor(() => expect(running).toHaveLength(1))
    expect(running[0].signal?.aborted).toBe(false)

    stopping.abort(new Error('the panel moved on'))
    await expect(asked).rejects.toThrow('the panel moved on')
    await vi.waitFor(() => expect(running[0].signal?.aborted).toBe(true))
  })

  it('leaves another search running when one is stopped', async () => {
    const { running, search } = await searching()
    const stopping = new AbortController()
    void search('first', { signal: stopping.signal }).catch(() => {})
    const second = search('second')
    await vi.waitFor(() => expect(running).toHaveLength(2))

    stopping.abort()
    await vi.waitFor(() => expect(running[0].signal?.aborted).toBe(true))
    expect(running[1].signal?.aborted).toBe(false)
    running[1].finish()
    expect(await second).toEqual({ ok: true, value: { results: [], totalMatches: 0 } })
  })

  it('tells whoever asked each file\'s matches as they are found, before the answer', async () => {
    const { running, search } = await searching()
    const heard: unknown[] = []
    const asked = search('needle', { heard: update => { heard.push(update) } })
    await vi.waitFor(() => expect(running).toHaveLength(1))

    const result: SearchResult = { path: 'a.ts', matches: [{ line: 1, column: 1, lineText: 'needle', matchStart: 0, matchEnd: 6 }] }
    running[0].found(result)
    await vi.waitFor(() => expect(heard).toEqual([{ result }]))
    running[0].finish()
    expect(await asked).toEqual({ ok: true, value: { results: [], totalMatches: 1 } })
  })
})
