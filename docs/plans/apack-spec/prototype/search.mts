// The app's code search, both halves, ported to the prototype:
//
//   backend   packages/default-setup/src/features/code/be/features/search.ts
//   surface   packages/default-setup/src/features/code/fe/features/search/state.ts
//
// The types are the app's own. `FileSystemRepository` below stands in for ../services/filesystem.ts with the same
// `searchFiles` signature, so that the last section can run.

import { reaching, system } from './state.mts'

// ── the app's types, unchanged ──────────────────────────────────────────────────────────────────────────────────────

interface SearchOptions {
  query: string
  path: string
  includePattern?: string
  excludePattern?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  maxResults?: number
}
interface SearchMatch { line: number; column: number; lineText: string; matchStart: number; matchEnd: number }
interface SearchResult { path: string; matches: SearchMatch[]; fileSize?: number }
interface SearchProgress { filesSearched: number; totalFiles: number; currentFile?: string }

/** Stands in for ../services/filesystem.ts: the same `searchFiles(options, onProgress, onResult, signal)`. */
class FileSystemRepository {
  constructor(readonly baseDirectory: string) {}
  async searchFiles(
    options: SearchOptions,
    onProgress?: (filesSearched: number, totalFiles: number, currentFile?: string) => void,
    onResult?: (result: SearchResult) => void,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const files = ['a.ts', 'b.ts', 'c.ts']
    const results: SearchResult[] = []
    for (const [index, file] of files.entries()) {
      await new Promise((resolve) => setImmediate(() => setImmediate(resolve)))
      if (signal?.aborted) throw signal.reason
      onProgress?.(index + 1, files.length, file)
      const result = { path: `${this.baseDirectory}/${file}`, matches: [{ line: 1, column: 1, lineText: options.query, matchStart: 0, matchEnd: options.query.length }] }
      results.push(result)
      onResult?.(result)
    }
    return results
  }
}

// ── what can be reached by name ─────────────────────────────────────────────────────────────────────────────────────

type SearchSystemEvent =
  | { type: 'UPDATE_BASE_DIRECTORY'; path: string }

type SearchSystemAsks = {
  SEARCH_FILES: {
    args: SearchOptions
    progress: { progress: SearchProgress } | { result: SearchResult }
    answer: { results: SearchResult[]; totalMatches: number }
    refuses: 'no-directory'
  }
}

type App = {
  systems: { 'code/search': { events: SearchSystemEvent; asks: SearchSystemAsks } }
  surfaces: {}
}
const state = reaching<App>()

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Backend: code/search
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type SearchSystem = {
  data: { repository: FileSystemRepository | null }
}

function searchSystem(baseDirectory: string | null) {
  return state<SearchSystem, SearchSystemEvent, SearchSystemAsks>()({
    data: { repository: baseDirectory ? new FileSystemRepository(baseDirectory) : null },

    asks: {
      async SEARCH_FILES(options, { data, progress, refuse, signal }) {
        if (!data.repository) throw refuse('no-directory', 'No directory selected. Please select a directory first.')

        let totalMatches = 0
        const results = await data.repository.searchFiles(
          options,
          (filesSearched, totalFiles, currentFile) => progress({ progress: { filesSearched, totalFiles, currentFile } }),
          (result) => { totalMatches += result.matches.length; progress({ result }) },
          signal,
        )
        return { results, totalMatches }
      },
    },

    on: {
      UPDATE_BASE_DIRECTORY: ({ path }) => ({ data: { repository: new FileSystemRepository(path) } }),
    },
  })
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Surface: the search panel
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type SearchSurface = {
  data: {
    baseDirectory: string | null
    searchQuery: string
    searchResults: SearchResult[]
    searchError: string | null
    searchOptions: { includePattern: string; excludePattern: string; caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
  }
  states: {
    idle: {}
    searching: { data: { searchProgress: SearchProgress | null } }
  }
}

type SearchSurfaceEvent =
  // from the user
  | { type: 'START'; query: string }
  | { type: 'CANCEL' }
  | { type: 'CLEAR' }
  | { type: 'UPDATE_OPTIONS'; options: Partial<SearchSurface['data']['searchOptions']> }
  | { type: 'CLEAR_ERROR' }
  // from the code surface
  | { type: 'DIRECTORY_CHANGED'; baseDirectory: string }
  // from its own search, as it runs
  | { type: 'RESULT'; data: SearchResult }
  | { type: 'PROGRESS'; data: SearchProgress }

const searchSurface = state<SearchSurface, SearchSurfaceEvent>()({
  data: {
    baseDirectory: null,
    searchQuery: '',
    searchResults: [],
    searchError: null,
    searchOptions: { includePattern: '', excludePattern: '', caseSensitive: false, wholeWord: false, useRegex: false },
  },
  start: 'idle',

  on: {
    // Going to `searching` while already there starts it again: the search in flight is aborted.
    START:  ({ query }) => ({ at: 'searching', data: { searchQuery: query, searchResults: [], searchError: null, searchProgress: null } }),
    CANCEL: ()          => ({ at: 'idle' }),
    CLEAR:  ()          => ({ at: 'idle', data: { searchQuery: '', searchResults: [], searchError: null } }),

    UPDATE_OPTIONS: ({ options }, { data }) => ({ data: { searchOptions: { ...data.searchOptions, ...options } } }),
    CLEAR_ERROR:    ()                      => ({ data: { searchError: null } }),

    DIRECTORY_CHANGED: ({ baseDirectory }, { data }) => ({
      data: {
        baseDirectory,
        // Clear the "No directory selected" error when a directory is selected
        searchError: baseDirectory && data.searchError?.includes('No directory selected') ? null : data.searchError,
      },
    }),
  },

  states: {
    idle: {},

    searching: {
      data: { searchProgress: null },

      async run({ data, ask, send }) {
        const found = await ask(
          'code/search', 'SEARCH_FILES',
          {
            query: data.searchQuery,
            path: data.baseDirectory ?? '',
            includePattern: data.searchOptions.includePattern || undefined,
            excludePattern: data.searchOptions.excludePattern || undefined,
            caseSensitive: data.searchOptions.caseSensitive,
            wholeWord: data.searchOptions.wholeWord,
            useRegex: data.searchOptions.useRegex,
          },
          (update) => send('result' in update ? { type: 'RESULT', data: update.result } : { type: 'PROGRESS', data: update.progress }),
        )

        return found.ok ? { at: 'idle' } : { at: 'idle', data: { searchError: found.failure.message } }
      },

      // Only a search that is running has results and progress arriving.
      on: {
        RESULT:   ({ data: result }, { data }) => ({ data: { searchResults: [...data.searchResults, result] } }),
        PROGRESS: ({ data: progress })         => ({ data: { searchProgress: progress } }),
      },
    },
  },
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Running both
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

if (process.argv[1]?.endsWith('search.mts')) {
  const turns = (count: number): Promise<void> => new Promise((resolve) => { let left = count; const tick = (): void => { if (left-- <= 0) resolve(); else setImmediate(tick) }; tick() })
  const lines: string[] = []

  const backend = system({ side: 'backend' })
  const theSystem = backend.start('code/search', searchSystem(null))

  const window = system({ side: 'window' })
  window.connect(backend)
  const panel = window.start('search', searchSurface)
  window.subscribe(() => {
    const now = window.read(panel)
    if (!now) return
    const progress = now.at === 'searching' && now.data.searchProgress ? ` | ${now.data.searchProgress.filesSearched}/${now.data.searchProgress.totalFiles}` : ''
    lines.push(`    ${now.at.padEnd(9)} "${now.data.searchQuery}" | ${now.data.searchResults.length} results${progress}${now.data.searchError ? ` | error "${now.data.searchError}"` : ''}`)
  })
  const say = (line: string): void => { lines.push(line) }

  say('search before a directory is chosen')
  window.send(panel, { type: 'START', query: 'todo' });                                   await turns(8)

  say('choose a directory, then search')
  backend.send(theSystem, { type: 'UPDATE_BASE_DIRECTORY', path: '/repo' })
  window.send(panel, { type: 'DIRECTORY_CHANGED', baseDirectory: '/repo' })
  window.send(panel, { type: 'START', query: 'todo' });                                   await turns(20)

  say('search, then search again before the first finishes')
  window.send(panel, { type: 'START', query: 'first' });                                  await turns(5)
  window.send(panel, { type: 'START', query: 'second' });                                 await turns(20)

  say('search, then cancel')
  window.send(panel, { type: 'START', query: 'third' });                                  await turns(5)
  window.send(panel, { type: 'CANCEL' });                                                 await turns(12)

  console.log(lines.join('\n'))
  window.stop(); backend.stop()
}
