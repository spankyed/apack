import type { AnswersTo, SearchAsks } from '../contract.ts'
import { sendToWindow } from '#generated/events.ts'
import { assign, setup, type ActorRefFrom, type AnyActorRef } from 'xstate'

import { FileSystemRepository } from '../services/filesystem.ts'
import type { SearchOptions, SearchProgress, SearchResult } from '../types.ts'

export interface CodeSearchSystemContext {
  repository: FileSystemRepository | null
  activeSearchController?: AbortController
}

export type Event =
  | { type: 'search.CANCEL_SEARCH' }
  | { type: 'search.ASSIGN_SEARCH_CONTROLLER'; controller: AbortController }
  | { type: 'search.CLEAR_SEARCH_CONTROLLER'; controller: AbortController }
  | { type: 'search.UPDATE_BASE_DIRECTORY'; path: string };

export const searchSystem = setup({
  types: {
    context: {} as CodeSearchSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null },
  },
  actions: {
    cancelSearch: ({ context }) => {
      if (context.activeSearchController) {
        context.activeSearchController.abort()
      }
    },

    // One search runs at a time: the one under way stops, and this one is held for a cancel to stop
    assignSearchController: assign({
      activeSearchController: ({ context, event }) => {
        const ev = event as { type: 'search.ASSIGN_SEARCH_CONTROLLER'; controller: AbortController }
        context.activeSearchController?.abort()
        return ev.controller
      }
    }),

    // A search that ends clears its own controller and no other: one replaced while it ran ends after the search
    // that replaced it began, whose controller is the one held by then
    clearSearchController: assign({
      activeSearchController: ({ context, event }) => {
        const ev = event as { type: 'search.CLEAR_SEARCH_CONTROLLER'; controller: AbortController }
        return context.activeSearchController === ev.controller ? undefined : context.activeSearchController
      }
    }),

    updateBaseDirectory: assign({
      repository: ({ event }) => {
        const ev = event as { type: 'search.UPDATE_BASE_DIRECTORY'; path: string }
        return new FileSystemRepository(ev.path)
      }
    }),
  },
}).createMachine({
  id: 'search',
  initial: 'idle',
  context: ({ input }: { input?: { baseDirectory: string | null } }) => ({
    repository: input?.baseDirectory ? new FileSystemRepository(input.baseDirectory) : null,
    activeSearchController: undefined
  }),
  states: {
    idle: {
      on: {
        'search.CANCEL_SEARCH': {
          actions: 'cancelSearch'
        },
        'search.ASSIGN_SEARCH_CONTROLLER': {
          actions: 'assignSearchController'
        },
        'search.CLEAR_SEARCH_CONTROLLER': {
          actions: 'clearSearchController'
        },
        'search.UPDATE_BASE_DIRECTORY': {
          actions: 'updateBaseDirectory'
        }
      }
    }
  }
})
/** The search, as the code system holds it: the folder searched, and the search under way */
const searchOf = (code: AnyActorRef) => code.getSnapshot().children.search as ActorRefFrom<typeof searchSystem> | undefined

/** The search asks, answered by the code system (`answers`, `system.ts`) over the search's folder */
export const searchAnswers: AnswersTo<SearchAsks> = {
  /**
   * Answered with every match once the search ends, and told as it goes to the window that asked: how far it is, and
   * each file's matches as they are found. A search asked for while it runs stops it, which is refused as superseded
   */
  'search.SEARCH_FILES': async ({ ask, self, client, failure }) => {
    const search = searchOf(self)
    const repository = search?.getSnapshot().context.repository
    if (!search || !repository) throw new Error('No directory selected. Please select a directory first.')

    const controller = new AbortController()
    search.send({ type: 'search.ASSIGN_SEARCH_CONTROLLER', controller })
    const tell = (event: { type: 'search.PROGRESS'; data: SearchProgress } | { type: 'search.RESULT'; data: SearchResult }) => {
      if (client && !controller.signal.aborted) sendToWindow(client, 'code', event)
    }
    try {
      const options: SearchOptions = {
        query: ask.query,
        path: ask.path,
        includePattern: ask.includePattern,
        excludePattern: ask.excludePattern,
        caseSensitive: ask.caseSensitive,
        wholeWord: ask.wholeWord,
        useRegex: ask.useRegex,
        maxResults: ask.maxResults,
      }
      let totalMatches = 0
      const results = await repository.searchFiles(
        options,
        (filesSearched, totalFiles, currentFile) => tell({ type: 'search.PROGRESS', data: { filesSearched, totalFiles, currentFile } }),
        (result) => {
          if (controller.signal.aborted) return
          totalMatches += result.matches.length
          tell({ type: 'search.RESULT', data: result })
        },
        controller.signal,
      ).catch((error: unknown) => {
        if (controller.signal.aborted) return undefined
        throw error
      })
      if (!results || controller.signal.aborted) throw failure('superseded', 'Another search was asked for, or this one was cancelled')
      return { results, totalMatches }
    } finally {
      search.send({ type: 'search.CLEAR_SEARCH_CONTROLLER', controller })
    }
  },
}
