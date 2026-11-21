import type { AnswersTo, SearchAsks } from '../contract.ts'
import { assign, setup, type ActorRefFrom, type AnyActorRef } from 'xstate'

import { FileSystemRepository } from '../services/filesystem.ts'
import type { SearchOptions } from '../types.ts'

export interface CodeSearchSystemContext {
  repository: FileSystemRepository | null
}

export type Event =
  | { type: 'search.UPDATE_BASE_DIRECTORY'; path: string };

export const searchSystem = setup({
  types: {
    context: {} as CodeSearchSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null },
  },
  actions: {
    updateBaseDirectory: assign({
      repository: ({ event }) => new FileSystemRepository(event.path)
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
        'search.UPDATE_BASE_DIRECTORY': {
          actions: 'updateBaseDirectory'
        }
      }
    }
  }
})
/** The search, as the code system holds it: the folder searched */
const searchOf = (code: AnyActorRef) => code.getSnapshot().children.search as ActorRefFrom<typeof searchSystem> | undefined

/** The search asks, answered by the code system (`answers`, `system.ts`) over the search's folder */
export const searchAnswers: AnswersTo<SearchAsks> = {
  /**
   * Answered with every match once the search ends, and told as it goes to whoever asked: how far it is, and each
   * file's matches as they are found. `signal` aborts when they stop waiting, which stops the search
   */
  'search.SEARCH_FILES': async ({ args, self, signal, progress }) => {
    const repository = searchOf(self)?.getSnapshot().context.repository
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
}
