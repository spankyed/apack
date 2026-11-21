import { setup, assign , type ActorRefFrom } from 'xstate';
import { fromAsk } from '#generated/events.ts';
import type { ProgressEventOf } from '@apackdev/sdk/events';
import { safeEvents } from '@apackdev/sdk/helpers';
import type { Contract as CodeSystemContract } from '#features/code/be/contract.ts';
import { getParentContext } from '../../utils/parent-communication.ts';

// Search types
export interface SearchMatch {
  line: number
  column: number
  lineText: string
  matchStart: number
  matchEnd: number
}

export interface SearchResult {
  path: string
  matches: SearchMatch[]
  fileSize?: number
}

export interface SearchProgress {
  filesSearched: number
  totalFiles: number
  currentFile?: string
}

export interface CodeSearchContext {
  searchQuery: string
  searchResults: SearchResult[]
  searchError: string | null
  searchProgress: SearchProgress | null
  searchOptions: {
    includePattern: string
    excludePattern: string
    caseSensitive: boolean
    wholeWord: boolean
    useRegex: boolean
  }
}

export type Event =
  | { type: 'search.START'; query: string }
  | { type: 'search.CANCEL' }
  | { type: 'search.CLEAR' }
  | { type: 'search.UPDATE_OPTIONS'; options: Partial<CodeSearchContext['searchOptions']> }
  | { type: 'search.CLEAR_ERROR' }
  | { type: 'search.DIRECTORY_CHANGED'; baseDirectory: string }
  | { type: 'CODE_STARTED' }
  // What the search asked for says as it runs: how far it is, and each file's matches
  | ProgressEventOf<CodeSystemContract, 'search.SEARCH_FILES'>;

const typeOf = safeEvents<Event>()

export const searchState = setup({
  types: {
    context: {} as CodeSearchContext,
    events: {} as Event
  },
  actors: {
    searchFiles: fromAsk('code', 'search.SEARCH_FILES'),
  },
  actions: {
    assignSearchQuery: assign({
      searchQuery: ({ event }) => typeOf('search.START', event).query,
      searchError: null,
      searchResults: []
    }),

    hearSearch: assign(({ context, event }) => {
      const { update } = typeOf('search.SEARCH_FILES.progress', event)
      return 'result' in update ? { searchResults: [...context.searchResults, update.result] } : { searchProgress: update.progress }
    }),

    clearSearch: assign({
      searchQuery: '',
      searchResults: [],
      searchError: null,
    }),

    clearError: assign({
      searchError: null
    }),

    updateSearchOptions: assign({
      searchOptions: ({ context, event }) => {
        const ev = typeOf('search.UPDATE_OPTIONS', event)
        return { ...context.searchOptions, ...ev.options }
      }
    }),

    handleDirectoryChanged: ({ self, context, event }) => {
      const ev = typeOf('search.DIRECTORY_CHANGED', event)
      // Clear the "No directory selected" error when a directory is selected
      if (context.searchError?.includes('No directory selected') && ev.baseDirectory) {
        self.send({ type: 'search.CLEAR_ERROR' })
      }
    }
  }
}).createMachine({
  id: 'search',
  initial: 'idle',
  context: {
    searchQuery: '',
    searchResults: [],
    searchError: null,
    searchProgress: null,
    searchOptions: {
      includePattern: '',
      excludePattern: '',
      caseSensitive: false,
      wholeWord: false,
      useRegex: false
    }
  },
  on: {
    // Entering `searching` again stops the search under way and starts this one
    'search.START': { target: '.searching', reenter: true, actions: 'assignSearchQuery' },
    'search.CANCEL': { target: '.idle' },
    'search.CLEAR': { target: '.idle', actions: 'clearSearch' },
    'search.UPDATE_OPTIONS': { actions: 'updateSearchOptions' },
    'search.CLEAR_ERROR': { actions: 'clearError' },
    'search.DIRECTORY_CHANGED': { actions: 'handleDirectoryChanged' },
    // Nothing to do as the code surface starts: a search with no directory says so when it is asked for
    'CODE_STARTED': {},
  },
  states: {
    idle: {},
    // A search is under way for exactly as long as this state is: leaving it stops the search on the backend
    searching: {
      invoke: {
        src: 'searchFiles',
        input: ({ context, self }) => ({
          query: context.searchQuery,
          path: getParentContext(self)?.baseDirectory,
          includePattern: context.searchOptions.includePattern || undefined,
          excludePattern: context.searchOptions.excludePattern || undefined,
          caseSensitive: context.searchOptions.caseSensitive,
          wholeWord: context.searchOptions.wholeWord,
          useRegex: context.searchOptions.useRegex,
        }),
        onDone: {
          target: 'idle',
          actions: assign({ searchError: ({ event }) => (event.output.ok ? null : event.output.failure.message) }),
        },
      },
      exit: assign({ searchProgress: null }),
      on: {
        'search.SEARCH_FILES.progress': { actions: 'hearSearch' },
      },
    },
  }
});

/** The search child's actor, named by whoever reads its context (`codeChild(…)`) */
export type SearchActor = ActorRefFrom<typeof searchState>;
