// An action's code as the code surface edits it in a tab: opened from the action, and saved back into it
import type { ActionsAsks } from '../contract.ts';
import type { NormalizeAsks } from '@apackdev/sdk/events';
import { state } from '#generated/state.ts';
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts';

/** The code system's child for actions' code. It holds nothing: its asks are answered from the actions' repository */
export const actionsSystem = state<{}, never, NormalizeAsks<ActionsAsks>>()({
  answers: {
    'codeActions.OPEN_ACTION': ({ actionId }, { refuse }) => {
      const action = repository.actionQueries.byId(actionId as EARS.EntityId);
      if (!action) throw refuse('not-found', `Action ${actionId} not found`);
      return { ...action, actionFnContent: action.actionFn };
    },
    'codeActions.SAVE_ACTION': ({ actionId, actionFn }, { refuse }) => {
      repository.actionCommands.update(actionId as EARS.EntityId, { actionFn });
      const updated = repository.actionQueries.byId(actionId as EARS.EntityId);
      if (!updated) throw refuse('not-found', `Action ${actionId} not found`);
      return updated;
    },
  },
});
