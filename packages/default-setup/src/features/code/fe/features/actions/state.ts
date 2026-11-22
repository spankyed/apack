import type { ActionTab } from '../../contract.ts';
export type { ActionTab } from '../../contract.ts';
import { setup, enqueueActions, type ActorRefFrom, type AnyActorRef, type OutputFrom } from 'xstate';
import { sendToSurface, fromAsk } from '#generated/events.ts';
import { safeEvents } from '@apackdev/sdk/helpers';
import { freshKey, makes, type MadeEvent, type Making } from '@apackdev/sdk/fe';
import { showTabInParent, updateTabsInParent } from '../../utils/parent-tabs.ts';
import type { EARS } from '#generated/ears.ts';

// The asks about an action's code. Several run at once, one per tab opening or saving, so each is made under a key
// of its own
const openAction = fromAsk('code', 'codeActions.OPEN_ACTION');
const saveAction = fromAsk('code', 'codeActions.SAVE_ACTION');
const made = makes(({ each }) => ({ open: each(openAction), save: each(saveAction) }));

export interface CodeActionsContext {
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
}

/** The action opens in a tab. One that could not be opened opens none */
function showOpenedAction(self: AnyActorRef, output: OutputFrom<typeof openAction>): void {
  if (!output.ok) return
  const action = output.value
  const tab: ActionTab = {
    path: `action:${action.id}`,
    content: action.actionFnContent || action.actionFn || '',
    modified: false,
    isAction: true,
    actionEntity: action,
  }
  showTabInParent(self, tab)
}

/** The saved action replaces the one its tab holds. One that could not be saved leaves the tab modified */
function takeSavedAction(self: AnyActorRef, output: OutputFrom<typeof saveAction>): void {
  if (!output.ok) return
  const action = output.value
  updateTabsInParent(self, file => file.isAction && file.actionEntity.id === action.id
    ? { ...file, actionEntity: action, modified: false }
    : file)
}

export type Event =
  | { type: 'codeActions.OPEN_ACTION'; actionId: string }
  | { type: 'codeActions.SAVE_ACTION'; actionId: string; content: string }
  // How an ask about an action's code ended
  | MadeEvent<typeof made>
  // Tab restoration
  | { type: 'codeActions.OPEN_TABS'; actionIds: string[] }
  /**
   * What the panel asks of the **actions surface**: its edits, which that surface sends its system.
   *
   * Sent from this machine rather than from the panel's click handlers: a component is not inside any delivery,
   * so a send it makes carries no `Message.sender` and the actions surface has no address to answer a refusal or
   * an error to. A send made from this machine carries the code surface's ref, because the shell names a surface
   * while it handles anything (`notifySurfaceActor`).
   *
   * The names match what they forward, so the hand-off reads as one; the `codeActions.` prefix is how the
   * code surface routes an event to this child.
   */
  | { type: 'codeActions.UPDATE_INPUT'; actionId: string; input: Record<string, unknown> }
  | { type: 'codeActions.UPDATE_LABEL'; actionId: string; label: string }
  | { type: 'codeActions.DELETE'; actionId: EARS.EntityId }
  | { type: 'codeActions.CREATE_INLINE'; label: string; actionFn: string; input: Record<string, unknown> };

const typeOf = safeEvents<Event>();

export const actionsState = setup({
  types: {
    context: {} as CodeActionsContext,
    events: {} as Event
  },
  actors: made.actors,
  actions: {
    openAction: enqueueActions(({ enqueue, event }) => {
      const { actionId } = typeOf('codeActions.OPEN_ACTION', event)
      made.make(enqueue, 'open', freshKey(), { actionId })
    }),

    saveAction: enqueueActions(({ enqueue, event }) => {
      const ev = typeOf('codeActions.SAVE_ACTION', event)
      made.make(enqueue, 'save', freshKey(), { actionId: ev.actionId, actionFn: ev.content })
    }),

    // The panel's asks of the actions surface, forwarded from here so each one carries a sender

    updateActionInput: ({ event }) => {
      const ev = typeOf('codeActions.UPDATE_INPUT', event)
      sendToSurface('actions', { type: 'ACTION.UPDATE_INPUT', actionId: ev.actionId, input: ev.input })
    },

    updateActionLabel: ({ event }) => {
      const ev = typeOf('codeActions.UPDATE_LABEL', event)
      sendToSurface('actions', { type: 'ACTION.UPDATE_LABEL', actionId: ev.actionId, label: ev.label })
    },

    deleteAction: ({ event }) => {
      const ev = typeOf('codeActions.DELETE', event)
      sendToSurface('actions', { type: 'ACTION.DELETE', actionId: ev.actionId })
    },

    createActionInline: ({ event }) => {
      const ev = typeOf('codeActions.CREATE_INLINE', event)
      sendToSurface('actions', { type: 'ACTION.CREATE_INLINE', label: ev.label, actionFn: ev.actionFn, input: ev.input })
    },

    /** The tabs a restore had open: one ask for each action */
    openActionTabs: enqueueActions(({ enqueue, event }) => {
      for (const actionId of typeOf('codeActions.OPEN_TABS', event).actionIds) {
        made.make(enqueue, 'open', freshKey(), { actionId })
      }
    })
  }
}).createMachine({
  id: 'codeActions',
  initial: 'idle',
  context: { making: made.none() },
  on: {
    'codeActions.OPEN_ACTION': {
      actions: 'openAction'
    },
    'codeActions.SAVE_ACTION': {
      actions: 'saveAction'
    },
    'codeActions.OPEN_TABS': {
      actions: 'openActionTabs'
    },
    // How its asks ended
    [made.done]: { actions: made.settle() },
    'made.open': { actions: ({ event, self }) => showOpenedAction(self, event.outcome) },
    'made.save': { actions: ({ event, self }) => takeSavedAction(self, event.outcome) },
    // The panel's asks of the actions surface
    'codeActions.UPDATE_INPUT': { actions: 'updateActionInput' },
    'codeActions.UPDATE_LABEL': { actions: 'updateActionLabel' },
    'codeActions.DELETE': { actions: 'deleteAction' },
    'codeActions.CREATE_INLINE': { actions: 'createActionInline' }
  },
  states: {
    idle: {}
  }
})

/** The actions child's actor, named by whoever reads its context (`codeChild(…)`) */
export type CodeActionsActor = ActorRefFrom<typeof actionsState>;
