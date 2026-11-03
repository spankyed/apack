import { answer } from '../answer.ts'
import { defineHandlers } from '@apackdev/sdk/framework';
import { createLogger } from '@apackdev/sdk/logger';
import { assign, setup } from 'xstate'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { IncomingCodeIndexEvents } from '../contract.ts'
import { extractFile } from '../code-index/extract.ts'
import { codeIndexCommands, codeIndexQueries, symbolIdOf } from '../code-index/repository.ts'
import { semanticDiff } from '../code-index/semantic-diff.ts'
import { createSyncRunner } from '../code-index/sync.ts'

const logger = createLogger('code-index')

export interface CodeIndexSystemContext {
  baseDirectory: string | null
  runner: ReturnType<typeof createSyncRunner>
}

export type Event =
  | IncomingCodeIndexEvents
  /** Something on disk or in git moved */
  | { type: 'codeIndex.SYNC' }
  | { type: 'codeIndex.UPDATE_BASE_DIRECTORY'; path: string }

const handlers = defineHandlers<CodeIndexSystemContext, Event>();

/** Where a symbol is now, read by parsing its file: no row holds a position, so a line moving writes nothing */
async function locate(id: string): Promise<{ path: string; line: number; column: number } | null> {
  const symbol = codeIndexQueries.symbol(id as Parameters<typeof codeIndexQueries.symbol>[0])
  const file = symbol && codeIndexQueries.file(symbol.file)
  const project = symbol && codeIndexQueries.projectOf(symbol.project)
  if (!symbol || !file || !project) return null
  const absolute = path.join(project.root, file.path)
  const extraction = extractFile(file.path, await fs.readFile(absolute, 'utf8'))
  if (!extraction.ok) return null
  const definition = extraction.definitions.find(candidate => symbolIdOf(symbol.project, file.path, candidate) === symbol.id)
  // An editor's columns count from 1, a syntax tree's from 0
  return { path: absolute, line: definition?.line ?? 1, column: (definition?.column ?? 0) + 1 }
}

export const codeIndexSystem = setup({
  types: {
    context: {} as CodeIndexSystemContext,
    events: {} as Event,
    input: {} as { baseDirectory: string | null },
  },
  actions: handlers.actions({
    requestSync: ({ context }) => { void context.runner.request(context.baseDirectory) },
    setEnabled: ({ context, event }) => {
      const ev = event as Extract<Event, { type: 'codeIndex.SET_ENABLED' }>
      if (!context.baseDirectory) return
      codeIndexCommands.setEnabled(context.baseDirectory, ev.enabled)
      void context.runner.request(context.baseDirectory)
    },
    locate: ({ event, reply }) => {
      const ev = event as Extract<Event, { type: 'codeIndex.LOCATE' }>
      locate(ev.symbol).then(
        location => answer(reply, { type: 'codeIndex.LOCATED', data: location }),
        (error: unknown) => {
          logger.error('Locating a symbol failed', { error })
          answer(reply, { type: 'codeIndex.LOCATED', data: null })
        },
      )
    },
    semanticDiff: ({ context, event, reply }) => {
      const ev = event as Extract<Event, { type: 'codeIndex.SEMANTIC_DIFF' }>
      if (!context.baseDirectory) return answer(reply, { type: 'codeIndex.SEMANTIC_DIFF_FAILED', data: { message: 'No directory selected.' } })
      semanticDiff(context.baseDirectory, ev.range).then(
        diff => answer(reply, { type: 'codeIndex.SEMANTIC_DIFF_READY', data: diff }),
        (error: unknown) => answer(reply, { type: 'codeIndex.SEMANTIC_DIFF_FAILED', data: { message: error instanceof Error ? error.message : String(error) } }),
      )
    },
  }),
}).createMachine({
  id: 'codeIndex',
  initial: 'running',
  context: ({ input }) => ({
    baseDirectory: input.baseDirectory,
    runner: createSyncRunner((error, root) => logger.error('Code index sync failed', { error, root })),
  }),
  entry: 'requestSync',
  exit: ({ context }) => { void context.runner.stop() },
  states: {
    running: {
      on: {
        'codeIndex.SYNC': { actions: 'requestSync' },
        'codeIndex.UPDATE_BASE_DIRECTORY': {
          actions: [assign({ baseDirectory: ({ event }) => event.path }), 'requestSync'],
        },
        'codeIndex.SET_ENABLED': { actions: 'setEnabled' },
        'codeIndex.LOCATE': { actions: 'locate' },
        'codeIndex.SEMANTIC_DIFF': { actions: 'semanticDiff' },
      },
    },
  },
})
