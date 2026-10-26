import { answer } from '../answer.ts'
import { defineHandlers } from '@apackdev/sdk/framework';
import { setup } from 'xstate'

import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'
import type { ActionEntity } from '@apackdev/sdk'

// Incoming events from frontend

// Outgoing events to frontend

export interface CodeActionsSystemContext {
  // No local state needed for actions feature
}

export type Event =
  | { type: 'codeActions.OPEN_ACTION'; actionId: string }
  | { type: 'codeActions.SAVE_ACTION'; actionId: string; actionFn: string };

/** Hands each handler the answer for the message it is handling — see `defineHandlers` */
const handlers = defineHandlers<CodeActionsSystemContext, Event>();

export const actionsSystem = setup({
  types: {
    context: {} as CodeActionsSystemContext,
    events: {} as Event,
  },
  actions: handlers.actions({
    openAction: ({ event, reply }) => {
      const ev = event as { type: 'codeActions.OPEN_ACTION'; actionId: string }
      const action = repository.actionQueries.byId(ev.actionId as EARS.EntityId)

      if (action) {
        // Include the actionFn content directly
        const actionWithContent: ActionEntity & { actionFnContent?: string } = {
          ...action,
          actionFnContent: action.actionFn
        }

        answer(reply, {
          type: 'codeActions.ACTION_SELECTED',
          actionId: ev.actionId as EARS.EntityId,
          data: actionWithContent
        })
      } else {
        answer(reply, {
          type: 'codeActions.CODE_ERROR',
          data: {
            message: `Action ${ev.actionId} not found`
          }
        })
      }
    },

    saveAction: ({ event, reply }) => {
      const ev = event as { type: 'codeActions.SAVE_ACTION'; actionId: string; actionFn: string }

      // Update the action with new actionFn
      repository.actionCommands.update(ev.actionId as EARS.EntityId, {
        actionFn: ev.actionFn
      })

      const updatedAction = repository.actionQueries.byId(ev.actionId as EARS.EntityId)
      if (updatedAction) {
        answer(reply, {
          type: 'codeActions.ACTION_UPDATED',
          action: updatedAction,
          actionId: updatedAction.id
        })
      }
    }
  })
}).createMachine({
  id: 'codeActions',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: {
        'codeActions.OPEN_ACTION': {
          actions: 'openAction'
        },
        'codeActions.SAVE_ACTION': {
          actions: 'saveAction'
        }
      }
    }
  }
})
