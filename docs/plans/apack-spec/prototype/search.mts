// The app's code search, both halves, ported to the prototype:
//
//   backend   packages/default-setup/src/features/code/be/features/search.ts
//   surface   packages/default-setup/src/features/code/fe/features/search/state.ts
//
// The types are the app's own. `FileSystemRepository` below stands in for ../services/filesystem.ts with the same
// `searchFiles` signature, so that the last section can run.

import { deepStrictEqual } from 'node:assert'
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
  views: {}
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
  // From its own search, as it runs. Nothing else may send it this.
  internal: { type: 'FOUND'; results: SearchResult[]; progress: SearchProgress | null }
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
          // Progress arrives as a list, at most once a frame: one change for all of it.
          (updates) => {
            const results: SearchResult[] = []
            let progress: SearchProgress | null = null
            for (const update of updates) { if ('result' in update) results.push(update.result); else progress = update.progress }
            send({ type: 'FOUND', results, progress })
          },
        )

        return found.ok ? { at: 'idle' } : { at: 'idle', data: { searchError: found.failure.message } }
      },

      // A search that could not be made is a refusal, handled above. This is for what `run` itself threw.
      failed: (error) => ({ at: 'idle', data: { searchError: error instanceof Error ? error.message : String(error) } }),

      // Only a search that is running has results and progress arriving, and only the search itself says so.
      internal: {
        FOUND: ({ results, progress }) => ({
          data: (d) => { d.searchResults.push(...results); if (progress) d.searchProgress = progress },
        }),
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
  // What each step must leave behind. The lines printed at the end are for reading; these are what is checked.
  let held = 0
  const holds = (what: string, actual: unknown, expected: unknown): void => {
    try { deepStrictEqual(actual, expected) } catch (error) { console.log(lines.join('\n')); throw new Error(`${what}\n${String(error)}`) }
    held++
  }
  /** Where it is, what it searched for, and the text each result matched: a result says which search found it. */
  const shown = () => { const now = window.read(panel); return { at: now.at, query: now.data.searchQuery, matched: now.data.searchResults.map((result) => result.matches[0]!.lineText), error: now.data.searchError } }

  say('search before a directory is chosen')
  window.send(panel, { type: 'START', query: 'todo' });                                   await turns(8)
  holds('a search with no directory ends with the reason', shown(), { at: 'idle', query: 'todo', matched: [], error: 'No directory selected. Please select a directory first.' })

  say('choose a directory, then search')
  backend.send(theSystem, { type: 'UPDATE_BASE_DIRECTORY', path: '/repo' })
  window.send(panel, { type: 'DIRECTORY_CHANGED', baseDirectory: '/repo' })
  window.send(panel, { type: 'START', query: 'todo' });                                   await turns(20)
  holds('a search finds every file, for what was asked', shown(), { at: 'idle', query: 'todo', matched: ['todo', 'todo', 'todo'], error: null })

  say('search, then search again before the first finishes')
  window.send(panel, { type: 'START', query: 'first' });                                  await turns(5)
  window.send(panel, { type: 'START', query: 'second' });                                 await turns(20)
  holds('only the second search is shown, and it searched for the second query', shown(), { at: 'idle', query: 'second', matched: ['second', 'second', 'second'], error: null })

  say('search, then cancel')
  window.send(panel, { type: 'START', query: 'third' });                                  await turns(5)
  window.send(panel, { type: 'CANCEL' })
  const atCancel = shown()
  await turns(12)
  holds('a cancelled search is idle with what it had found, all of it for its own query', atCancel, { at: 'idle', query: 'third', matched: ['third'], error: null })
  holds('and nothing arrives after the cancel', shown(), atCancel)

  console.log(lines.join('\n'))
  console.log(`\n${held} things held`)
  window.stop(); backend.stop()
}
