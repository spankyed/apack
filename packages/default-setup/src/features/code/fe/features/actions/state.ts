import type { ActionTab } from '../../contract.ts';
export type { ActionTab } from '../../contract.ts';
import { setup, enqueueActions, type ActorRefFrom, type AnyActorRef, type DoneActorEvent, type OutputFrom } from 'xstate';
import { sendToSurface, fromAsk } from '#generated/events.ts';
import { safeEvents } from '@apackdev/sdk/helpers';
import { askId, endedAsk } from '@apackdev/sdk/fe';
import { showTabInParent, updateTabsInParent } from '../../utils/parent-tabs.ts';
import type { EARS } from '#generated/ears.ts';

// The asks about an action's code. Several run at once, one per tab opening or saving, so each is spawned under
// an id of its own (`open.<n>`, `save.<n>`) and its outcome arrives as that actor's done event
const openAction = fromAsk('code', 'codeActions.OPEN_ACTION');
const saveAction = fromAsk('code', 'codeActions.SAVE_ACTION');

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
  | DoneActorEvent<OutputFrom<typeof openAction>, `open.${number}`>
  | DoneActorEvent<OutputFrom<typeof saveAction>, `save.${number}`>
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
    context: {} as Record<string, never>,
    events: {} as Event
  },
  actors: { openAction, saveAction },
  actions: {
    openAction: enqueueActions(({ enqueue, event }) => {
      const { actionId } = typeOf('codeActions.OPEN_ACTION', event)
      enqueue.spawnChild('openAction', { id: askId('open'), input: { actionId } })
    }),

    saveAction: enqueueActions(({ enqueue, event }) => {
      const ev = typeOf('codeActions.SAVE_ACTION', event)
      enqueue.spawnChild('saveAction', { id: askId('save'), input: { actionId: ev.actionId, actionFn: ev.content } })
    }),

    /** An ask that ended stops being this machine's child */
    forgetAsk: enqueueActions(({ enqueue, event }) => {
      const id = endedAsk(event)
      enqueue.stopChild(id)
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
        enqueue.spawnChild('openAction', { id: askId('open'), input: { actionId } })
      }
    })
  }
}).createMachine({
  id: 'codeActions',
  initial: 'idle',
  context: {},
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
    'xstate.done.actor.open.*': { actions: [({ event, self }) => showOpenedAction(self, event.output), 'forgetAsk'] },
    'xstate.done.actor.save.*': { actions: [({ event, self }) => takeSavedAction(self, event.output), 'forgetAsk'] },
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
