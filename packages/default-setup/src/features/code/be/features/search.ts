import { answer } from '../answer.ts'
import { defineHandlers } from '@apackdev/sdk/framework';
import { assign, setup } from 'xstate'

import { FileSystemRepository } from '../services/filesystem.ts'
import type { SearchOptions } from '../types.ts'

// Incoming events from frontend

// Outgoing events to frontend

export interface CodeSearchSystemContext {
  repository: FileSystemRepository | null
  activeSearchController?: AbortController
}

export type Event =
  | { type: 'search.SEARCH_FILES';
      query: string;
      path: string;
      includePattern?: string;
      excludePattern?: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
      maxResults?: number;
    }
  | { type: 'search.CANCEL_SEARCH' }
  | { type: 'search.ASSIGN_SEARCH_CONTROLLER'; controller: AbortController }
  | { type: 'search.CLEAR_SEARCH_CONTROLLER' }
  | { type: 'search.UPDATE_BASE_DIRECTORY'; path: string };

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeSearchSystemContext, Event>();

export const searchSystem = setup({
  types: {
    context: {} as CodeSearchSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null },
  },
  actions: handlers.actions({
    searchFiles: async ({ event, context, self, reply }) => {
      const ev = event as {
        type: 'search.SEARCH_FILES';
        query: string;
        path: string;
        includePattern?: string;
        excludePattern?: string;
        caseSensitive?: boolean;
        wholeWord?: boolean;
        useRegex?: boolean;
        maxResults?: number;
      }

      if (!context.repository) {
        answer(reply, {
          type: 'search.ERROR',
          data: { message: 'No directory selected. Please select a directory first.' }
        })
        return
      }

      // Cancel any existing search
      if (context.activeSearchController) {
        context.activeSearchController.abort()
      }

      // Create new abort controller
      const controller = new AbortController()
      self.send({ type: 'search.ASSIGN_SEARCH_CONTROLLER', controller })

      try {
        const searchOptions: SearchOptions = {
          query: ev.query,
          path: ev.path,
          includePattern: ev.includePattern,
          excludePattern: ev.excludePattern,
          caseSensitive: ev.caseSensitive,
          wholeWord: ev.wholeWord,
          useRegex: ev.useRegex,
          maxResults: ev.maxResults
        }

        let totalMatches = 0

        const results = await context.repository.searchFiles(
          searchOptions,
          // Progress callback
          (filesSearched, totalFiles, currentFile) => {
            if (!controller.signal.aborted) {
              answer(reply, {
                type: 'search.PROGRESS',
                data: { filesSearched, totalFiles, currentFile }
              })
            }
          },
          // Result callback (incremental results)
          (result) => {
            if (!controller.signal.aborted) {
              totalMatches += result.matches.length
              answer(reply, {
                type: 'search.RESULT',
                data: result
              })
            }
          }
        )

        if (!controller.signal.aborted) {
          answer(reply, {
            type: 'search.COMPLETE',
            data: { results, totalMatches }
          })
        }
      } catch (error: any) {
        if (!controller.signal.aborted) {
          answer(reply, {
            type: 'search.ERROR',
            data: { message: error.message }
          })
        }
      } finally {
        self.send({ type: 'search.CLEAR_SEARCH_CONTROLLER' })
      }
    },

    cancelSearch: ({ context }) => {
      if (context.activeSearchController) {
        context.activeSearchController.abort()
      }
    },

    assignSearchController: assign({
      activeSearchController: ({ event }) => {
        const ev = event as { type: 'search.ASSIGN_SEARCH_CONTROLLER'; controller: AbortController }
        return ev.controller
      }
    }),

    clearSearchController: assign({
      activeSearchController: undefined
    }),

    updateBaseDirectory: assign({
      repository: ({ event }) => {
        const ev = event as { type: 'search.UPDATE_BASE_DIRECTORY'; path: string }
        return new FileSystemRepository(ev.path)
      }
    }),
  })
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
        'search.SEARCH_FILES': {
          actions: 'searchFiles'
        },
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