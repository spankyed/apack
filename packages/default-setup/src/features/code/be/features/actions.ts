// An action's code as the code surface edits it in a tab: opened from the action, and saved back into it
import type { AnswersTo, ActionsAsks } from '../contract.ts'
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'

/** The asks about an action's code, answered by the code system (`answers`, `system.ts`) */
export const actionsAnswers: AnswersTo<ActionsAsks> = {
  'codeActions.OPEN_ACTION': ({ ask: { actionId }, failure }) => {
    const action = repository.actionQueries.byId(actionId as EARS.EntityId)
    if (!action) throw failure('not-found', `Action ${actionId} not found`)
    return { ...action, actionFnContent: action.actionFn }
  },
  'codeActions.SAVE_ACTION': ({ ask: { actionId, actionFn }, failure }) => {
    repository.actionCommands.update(actionId as EARS.EntityId, { actionFn })
    const updated = repository.actionQueries.byId(actionId as EARS.EntityId)
    if (!updated) throw failure('not-found', `Action ${actionId} not found`)
    return updated
  },
}
