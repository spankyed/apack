import { answer } from '../answer.ts'
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup } from 'xstate'

import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'
import type { PromptEntity } from '@apackdev/sdk'

// Incoming events from frontend

// Outgoing events to frontend

export interface CodePromptsSystemContext {
  // No local state needed for prompts feature
}

export type Event =
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
  | { type: 'codePrompts.SAVE_PROMPT'; promptId: string; templateFn: string };

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodePromptsSystemContext, Event>();

export const promptsSystem = setup({
  types: {
    context: {} as CodePromptsSystemContext,
    events: {} as Event,
  },
  actions: handlers.actions({
    openPrompt: ({ event, reply }) => {
      const ev = event as { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
      const prompt = repository.promptQueries.byId(ev.promptId as EARS.EntityId)

      if (prompt) {
        // Include the templateFn content directly
        const promptWithContent: PromptEntity & { templateFnContent?: string } = {
          ...prompt,
          templateFnContent: prompt.templateFn
        }

        answer(reply, {
          type: 'codePrompts.PROMPT_SELECTED',
          promptId: ev.promptId as EARS.EntityId,
          data: promptWithContent
        })
      } else {
        answer(reply, {
          type: 'codePrompts.CODE_ERROR',
          data: {
            message: `Prompt ${ev.promptId} not found`
          }
        })
      }
    },

    savePrompt: ({ event, reply }) => {
      const ev = event as { type: 'codePrompts.SAVE_PROMPT'; promptId: string; templateFn: string }

      // Update the prompt with new templateFn
      repository.promptCommands.update(ev.promptId as EARS.EntityId, {
        templateFn: ev.templateFn
      })

      const updatedPrompt = repository.promptQueries.byId(ev.promptId as EARS.EntityId)
      if (updatedPrompt) {
        answer(reply, {
          type: 'codePrompts.PROMPT_UPDATED',
          prompt: updatedPrompt,
          promptId: updatedPrompt.id
        })
      }
    }
  })
}).createMachine({
  id: 'codePrompts',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: {
        'codePrompts.OPEN_PROMPT': {
          actions: 'openPrompt'
        },
        'codePrompts.SAVE_PROMPT': {
          actions: 'savePrompt'
        }
      }
    }
  }
})
