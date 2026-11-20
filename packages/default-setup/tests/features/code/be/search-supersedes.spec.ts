import { createActor } from 'xstate'
import { FileSystemRepository } from '#features/code/be/services/filesystem.ts'
import { searchSystem } from '#features/code/be/features/search.ts'
import type { SearchResult } from '#features/code/be/types.ts'

/** A search under way: the signal the repository was handed for it, and how to end it */
interface Running { signal: AbortSignal | undefined; finish(): void }

/** A search system over a repository whose searches run until the spec ends them */
function searching() {
  const running: Running[] = []
  vi.spyOn(FileSystemRepository.prototype, 'searchFiles').mockImplementation((_options, _onProgress, _onResult, signal?: AbortSignal) =>
    new Promise<SearchResult[]>(resolve => { running.push({ signal, finish: () => resolve([]) }) }))
  const system = createActor(searchSystem, { input: { baseDirectory: '/somewhere' } }).start()
  const search = (query: string) => system.send({ type: 'search.SEARCH_FILES', query, path: '/somewhere' })
  return { running, system, search }
}

/** Lets a finished search's handler run to its end, and the events it sent be taken */
const settled = () => new Promise<void>(resolve => setImmediate(resolve))

afterEach(() => { vi.restoreAllMocks() })

describe('the search system', () => {
  it('stops the search under way when another is asked for', () => {
    const { running, search } = searching()
    search('first')
    search('second')
    expect(running.map(each => each.signal?.aborted)).toEqual([true, false])
  })

  it('stops the search under way when it is cancelled', () => {
    const { running, system, search } = searching()
    search('only')
    system.send({ type: 'search.CANCEL_SEARCH' })
    expect(running[0].signal?.aborted).toBe(true)
  })

  it('can still cancel a search once the one it replaced has ended', async () => {
    const { running, system, search } = searching()
    search('first')
    search('second')
    // The replaced search winds up after the one that replaced it began
    running[0].finish()
    await settled()
    system.send({ type: 'search.CANCEL_SEARCH' })
    expect(running[1].signal?.aborted).toBe(true)
  })
})
