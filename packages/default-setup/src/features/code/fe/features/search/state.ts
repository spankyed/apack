import { state } from '#generated/state.ts';

// Search types
export interface SearchMatch {
  line: number;
  column: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchResult {
  path: string;
  matches: SearchMatch[];
  fileSize?: number;
}

export interface SearchProgress {
  filesSearched: number;
  totalFiles: number;
  currentFile?: string;
}

export interface CodeSearchData {
  baseDirectory: string;
  searchQuery: string;
  searchResults: SearchResult[];
  searchError: string | null;
  searchProgress: SearchProgress | null;
  searchOptions: {
    includePattern: string;
    excludePattern: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
  };
}

export type CodeSearchEvent =
  | { type: 'search.START'; query: string }
  | { type: 'search.CANCEL' }
  | { type: 'search.CLEAR' }
  | { type: 'search.UPDATE_OPTIONS'; options: Partial<CodeSearchData['searchOptions']> }
  | { type: 'search.CLEAR_ERROR' }
  | { type: 'search.DIRECTORY_CHANGED'; baseDirectory: string }
  | { type: 'CODE_STARTED'; baseDirectory?: string };

type CodeSearchShape = {
  data: CodeSearchData;
  states: {
    idle: {};
    searching: {
      calls: {
        searchFiles: 'one';
      };
    };
  };
};

export const searchState = state<CodeSearchShape, CodeSearchEvent>()({
  initial: 'idle',
  data: {
    baseDirectory: '',
    searchQuery: '',
    searchResults: [],
    searchError: null,
    searchProgress: null,
    searchOptions: {
      includePattern: '',
      excludePattern: '',
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
    },
  },
  on: {
    // Entering `searching` again stops the search under way and starts this one
    'search.START': ({ query }) => ({
      at: 'searching',
      data: {
        searchQuery: query,
        searchError: null,
        searchResults: [],
        searchProgress: null,
      },
    }),
    'search.CANCEL': (_event, { snapshot }) =>
      snapshot.at === 'searching' ? { at: 'idle', data: { searchProgress: null } } : undefined,
    'search.CLEAR': (_event, { snapshot }) =>
      snapshot.at === 'searching'
        ? { at: 'idle', data: { searchQuery: '', searchResults: [], searchError: null, searchProgress: null } }
        : { data: { searchQuery: '', searchResults: [], searchError: null, searchProgress: null } },
    'search.UPDATE_OPTIONS': ({ options }, { data }) => ({
      data: { searchOptions: { ...data.searchOptions, ...options } },
    }),
    'search.CLEAR_ERROR': () => ({ data: { searchError: null } }),
    'search.DIRECTORY_CHANGED': ({ baseDirectory }, { data }) => ({
      data: {
        baseDirectory,
        // Clear the "No directory selected" error when a directory is selected
        ...(data.searchError?.includes('No directory selected') && baseDirectory ? { searchError: null } : {}),
      },
    }),
    // Nothing to search on start: a search with no directory says so when it is asked for
    CODE_STARTED: ({ baseDirectory }) =>
      baseDirectory !== undefined ? { data: { baseDirectory } } : undefined,
  },
  states: {
    idle: {},
    // A search is under way for exactly as long as this state is: leaving it stops the search on the backend
    searching: {
      calls: ({ one }) => ({
        searchFiles: one('code', 'search.SEARCH_FILES', {
          args: (data) => ({
            query: data.searchQuery,
            path: data.baseDirectory,
            includePattern: data.searchOptions.includePattern || undefined,
            excludePattern: data.searchOptions.excludePattern || undefined,
            caseSensitive: data.searchOptions.caseSensitive,
            wholeWord: data.searchOptions.wholeWord,
            useRegex: data.searchOptions.useRegex,
          }),
          progress: (updates, { data }) => {
            const added: SearchResult[] = [];
            let nextProgress: SearchProgress | undefined;
            for (const update of updates) {
              if ('result' in update) added.push(update.result);
              else nextProgress = update.progress;
            }
            if (added.length === 0 && nextProgress === undefined) return;
            return {
              data: {
                ...(added.length > 0 ? { searchResults: [...data.searchResults, ...added] } : {}),
                ...(nextProgress !== undefined ? { searchProgress: nextProgress } : {}),
              },
            };
          },
          done: (outcome) => ({
            at: 'idle',
            data: {
              searchProgress: null,
              searchError: outcome.ok ? null : outcome.failure.message,
            },
          }),
        }),
      }),
      run: ({ call }) => {
        call('searchFiles');
      },
    },
  },
});
