import type { ActionEntity, EARS } from '@apackdev/sdk';
import { state, type PackNet } from '#generated/state.ts';
import type { ActionTab } from '../../contract.ts';
export type { ActionTab } from '../../contract.ts';

type CodeAsks = PackNet['systems']['code']['asks'];

export type CodeActionsReport =
  | { type: 'CODE_ACTIONS_SHOW_TAB'; tab: ActionTab }
  | { type: 'CODE_ACTIONS_ACTION_SAVED'; action: ActionEntity };

export type CodeActionsEvent =
  | { type: 'codeActions.OPEN_ACTION'; actionId: string }
  | { type: 'codeActions.SAVE_ACTION'; actionId: string; content: string }
  // Tab restoration
  | { type: 'codeActions.OPEN_TABS'; actionIds: string[] }
  /**
   * What the panel asks of the **actions surface**: its edits, which that surface sends its system.
   *
   * Sent from this machine rather than from the panel's click handlers: a component is not inside any delivery,
   * so a send it makes carries no `Message.sender` and the actions surface has no address to answer a refusal or
   * an error to. A send made from this machine carries the code surface's ref.
   */
  | { type: 'codeActions.UPDATE_INPUT'; actionId: string; input: Record<string, unknown> }
  | { type: 'codeActions.UPDATE_LABEL'; actionId: string; label: string }
  | { type: 'codeActions.DELETE'; actionId: EARS.EntityId }
  | { type: 'codeActions.CREATE_INLINE'; label: string; actionFn: string; input: Record<string, unknown> };

type CodeActionsShape = {
  reports: CodeActionsReport;
  calls: {
    open: { readonly many: CodeAsks['codeActions.OPEN_ACTION']['args'] };
    save: { readonly many: CodeAsks['codeActions.SAVE_ACTION']['args'] };
  };
};

export const actionsState = state<CodeActionsShape, CodeActionsEvent>()({
  calls: ({ many }) => ({
    // The asks about an action's code. Several run at once, one per tab opening or saving.
    open: many('code', 'codeActions.OPEN_ACTION', {
      done: (outcome, { report }) => {
        if (!outcome.ok) return;
        const action = outcome.value;
        const tab: ActionTab = {
          path: `action:${action.id}`,
          content: action.actionFnContent || action.actionFn || '',
          modified: false,
          isAction: true,
          actionEntity: action,
        };
        report({ type: 'CODE_ACTIONS_SHOW_TAB', tab });
      },
    }),
    save: many('code', 'codeActions.SAVE_ACTION', {
      done: (outcome, { report }) => {
        if (!outcome.ok) return;
        report({ type: 'CODE_ACTIONS_ACTION_SAVED', action: outcome.value });
      },
    }),
  }),
  on: {
    'codeActions.OPEN_ACTION': ({ actionId }, { call }) => {
      call('open', { actionId });
    },
    'codeActions.SAVE_ACTION': ({ actionId, content }, { call }) => {
      call('save', { actionId, actionFn: content });
    },
    'codeActions.OPEN_TABS': ({ actionIds }, { call }) => {
      for (const actionId of actionIds) {
        call('open', { actionId });
      }
    },
    // The panel's asks of the actions surface, forwarded from here so each one carries a sender
    'codeActions.UPDATE_INPUT': ({ actionId, input }, { tell }) => {
      tell({ surface: 'actions' }, { type: 'ACTION.UPDATE_INPUT', actionId, input });
    },
    'codeActions.UPDATE_LABEL': ({ actionId, label }, { tell }) => {
      tell({ surface: 'actions' }, { type: 'ACTION.UPDATE_LABEL', actionId, label });
    },
    'codeActions.DELETE': ({ actionId }, { tell }) => {
      tell({ surface: 'actions' }, { type: 'ACTION.DELETE', actionId });
    },
    'codeActions.CREATE_INLINE': ({ label, actionFn, input }, { tell }) => {
      tell({ surface: 'actions' }, { type: 'ACTION.CREATE_INLINE', label, actionFn, input });
    },
  },
});
