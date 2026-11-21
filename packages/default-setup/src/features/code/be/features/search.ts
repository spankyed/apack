import type { SearchAsks } from '../contract.ts'
import { defineHandlers } from '@apackdev/sdk/framework'
import type { AsksEvents } from '@apackdev/sdk/events'
import { assign, setup } from 'xstate'
import { safeEvents } from '@apackdev/sdk/helpers'

import { FileSystemRepository } from '../services/filesystem.ts'
import type { SearchOptions } from '../types.ts'

export interface CodeSearchSystemContext {
  repository: FileSystemRepository | null
}

export type Event =
  | { type: 'search.UPDATE_BASE_DIRECTORY'; path: string }
  // The search asks, which the code system forwards here to be answered
  | AsksEvents<SearchAsks>;

const handlers = defineHandlers<CodeSearchSystemContext, Event>();

/** The search asks, answered here over the folder this machine holds */
const answers = handlers.answers<SearchAsks>({
  /**
   * Answered with every match once the search ends, and told as it goes to whoever asked: how far it is, and each
   * file's matches as they are found. `signal` aborts when they stop waiting, which stops the search
   */
  'search.SEARCH_FILES': async ({ args, context, signal, progress }) => {
    const { repository } = context
    if (!repository) throw new Error('No directory selected. Please select a directory first.')

    const options: SearchOptions = {
      query: args.query,
      path: args.path,
      includePattern: args.includePattern,
      excludePattern: args.excludePattern,
      caseSensitive: args.caseSensitive,
      wholeWord: args.wholeWord,
      useRegex: args.useRegex,
      maxResults: args.maxResults,
    }
    let totalMatches = 0
    const results = await repository.searchFiles(
      options,
      (filesSearched, totalFiles, currentFile) => progress({ progress: { filesSearched, totalFiles, currentFile } }),
      (result) => {
        totalMatches += result.matches.length
        progress({ result })
      },
      signal,
    )
    return { results, totalMatches }
  },
});

const typeOf = safeEvents<Event>()

export const searchSystem = setup({
  types: {
    context: {} as CodeSearchSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null },
  },
  actions: {
    ...answers.actions,
    updateBaseDirectory: assign({
      repository: ({ event }) => new FileSystemRepository(typeOf('search.UPDATE_BASE_DIRECTORY', event).path)
    }),
  },
}).createMachine({
  id: 'search',
  initial: 'idle',
  context: ({ input }: { input?: { baseDirectory: string | null } }) => ({
    repository: input?.baseDirectory ? new FileSystemRepository(input.baseDirectory) : null,
  }),
  states: {
    idle: {
      on: {
        ...answers.on,
        'search.UPDATE_BASE_DIRECTORY': {
          actions: 'updateBaseDirectory'
        }
      }
    }
  }
})
