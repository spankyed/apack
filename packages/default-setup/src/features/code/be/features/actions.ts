// An action's code as the code surface edits it in a tab: opened from the action, and saved back into it
import type { ActionsAsks } from '../contract.ts'
import { defineHandlers } from '@apackdev/sdk/framework'
import type { AsksEvents } from '@apackdev/sdk/events'
import { setup } from 'xstate'
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'

// The asks about an action's code, which the code system forwards here to be answered
export type Event = AsksEvents<ActionsAsks>;

const handlers = defineHandlers<Record<string, never>, Event>();

/** The asks about an action's code, answered here from the actions' repository */
const answers = handlers.answers<ActionsAsks>({
  'codeActions.OPEN_ACTION': ({ args: { actionId }, refuse }) => {
    const action = repository.actionQueries.byId(actionId as EARS.EntityId)
    if (!action) throw refuse('not-found', `Action ${actionId} not found`)
    return { ...action, actionFnContent: action.actionFn }
  },
  'codeActions.SAVE_ACTION': ({ args: { actionId, actionFn }, refuse }) => {
    repository.actionCommands.update(actionId as EARS.EntityId, { actionFn })
    const updated = repository.actionQueries.byId(actionId as EARS.EntityId)
    if (!updated) throw refuse('not-found', `Action ${actionId} not found`)
    return updated
  },
});

/** The code system's child for actions' code. It holds nothing: its id is the prefix its asks are forwarded by */
export const actionsSystem = setup({
  types: {
    context: {} as Record<string, never>,
    events: {} as Event,
  },
  actions: { ...answers.actions },
}).createMachine({
  id: 'codeActions',
  context: {},
  on: { ...answers.on },
})
