import { setup, assign , type ActorRefFrom } from 'xstate';
import { sendToSystem } from '#generated/events.ts';
import { isAnswered, type AnswersOf } from '@apackdev/sdk/events';
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
  isSearching: boolean
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
  | { type: 'search.RESULT'; data: SearchResult }
  | { type: 'search.PROGRESS'; data: SearchProgress }
  | { type: 'search.CLEAR_ERROR' }
  | { type: 'search.DIRECTORY_CHANGED'; baseDirectory: string }
  | { type: 'CODE_STARTED' }
  // The answer to the search asked for, which the surface routes here
  | AnswersOf<CodeSystemContract, 'search.SEARCH_FILES'>;

export const searchState = setup({
  types: {
    context: {} as CodeSearchContext,
    events: {} as Event
  },
  actions: {
    startSearch: ({ event, context, self }) => {
      const ev = event as { type: 'search.START'; query: string }
      const parentContext = getParentContext(self)

      sendToSystem('code', {
        type: 'search.SEARCH_FILES',
        query: ev.query,
        path: parentContext?.baseDirectory,
        includePattern: context.searchOptions.includePattern || undefined,
        excludePattern: context.searchOptions.excludePattern || undefined,
        caseSensitive: context.searchOptions.caseSensitive,
        wholeWord: context.searchOptions.wholeWord,
        useRegex: context.searchOptions.useRegex,
      })
    },

    cancelSearch: () => {
      sendToSystem('code', { type: 'search.CANCEL_SEARCH' })
    },

    assignSearchQuery: assign({
      searchQuery: ({ event }) => {
        const ev = event as { type: 'search.START'; query: string }
        return ev.query
      },
      isSearching: true,
      searchError: null,
      searchResults: []
    }),

    assignSearchResult: assign({
      searchResults: ({ context, event }) => {
        const ev = event as { type: 'search.RESULT'; data: SearchResult }
        return [...context.searchResults, ev.data]
      }
    }),

    assignSearchProgress: assign({
      searchProgress: ({ event }) => {
        const ev = event as { type: 'search.PROGRESS'; data: SearchProgress }
        return ev.data
      }
    }),

    assignSearchComplete: assign({
      isSearching: false,
      searchProgress: null
    }),

    assignSearchError: assign({
      searchError: ({ event }) => (event as { type: 'ASK_FAILED'; failure: { message: string } }).failure.message,
      isSearching: false,
      searchProgress: null
    }),

    clearSearch: assign({
      searchQuery: '',
      searchResults: [],
      isSearching: false,
      searchError: null,
      searchProgress: null
    }),

    clearError: assign({
      searchError: null
    }),

    updateSearchOptions: assign({
      searchOptions: ({ context, event }) => {
        const ev = event as { type: 'search.UPDATE_OPTIONS'; options: Partial<CodeSearchContext['searchOptions']> }
        return { ...context.searchOptions, ...ev.options }
      }
    }),

    handleCodeStartup: () => {
      // No immediate action needed on startup
      // Error will be shown if user tries to search without a directory
    },

    handleDirectoryChanged: ({ self, context, event }) => {
      const ev = event as { type: 'search.DIRECTORY_CHANGED'; baseDirectory: string }
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
    isSearching: false,
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
  states: {
    idle: {
      on: {
        'search.START': {
          actions: ['assignSearchQuery', 'startSearch']
        },
        'search.CANCEL': {
          actions: 'cancelSearch'
        },
        'search.CLEAR': {
          actions: 'clearSearch'
        },
        'search.UPDATE_OPTIONS': {
          actions: 'updateSearchOptions'
        },
        'search.RESULT': {
          guard: ({ context }) => context.searchQuery !== '',
          actions: 'assignSearchResult'
        },
        'search.PROGRESS': {
          guard: ({ context }) => context.searchQuery !== '',
          actions: 'assignSearchProgress'
        },
        ASK_ANSWERED: {
          guard: ({ event }) => isAnswered(event, 'search.SEARCH_FILES'),
          actions: 'assignSearchComplete'
        },
        // A search another replaced is not this one's to end
        ASK_FAILED: {
          guard: ({ event }) => event.asked === 'search.SEARCH_FILES' && event.failure.kind !== 'superseded',
          actions: 'assignSearchError'
        },
        'search.CLEAR_ERROR': {
          actions: 'clearError'
        },
        'search.DIRECTORY_CHANGED': {
          actions: 'handleDirectoryChanged'
        },
        'CODE_STARTED': {
          actions: 'handleCodeStartup'
        }
      }
    }
  }
});

/** The search child's actor, named by whoever reads its context (`codeChild(…)`) */
export type SearchActor = ActorRefFrom<typeof searchState>;
