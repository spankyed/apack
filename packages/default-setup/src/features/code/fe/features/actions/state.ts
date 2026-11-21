import type { ActionTab } from '../../contract.ts';
export type { ActionTab } from '../../contract.ts';
import { setup, enqueueActions, type ActorRefFrom, type DoneActorEvent, type OutputFrom } from 'xstate';
import { sendToSurface, fromAsk } from '#generated/events.ts';
import { safeEvents } from '@apackdev/sdk/helpers';
import { updateParentState, getParentContext, addTabToParent } from '../../utils/parent-communication.ts';
import type { EARS } from '#generated/ears.ts';

// The asks about an action's code. Several run at once, one per tab opening or saving, so each is spawned under
// an id of its own (`open.<n>`, `save.<n>`) and its outcome arrives as that actor's done event
const openAction = fromAsk('code', 'codeActions.OPEN_ACTION');
const saveAction = fromAsk('code', 'codeActions.SAVE_ACTION');
let asks = 0;

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
   * The panel used to send these straight to that surface from its click handlers. Two things were wrong
   * with that and the second is why they are here rather than merely tidier: a component is not inside any
   * delivery, so the send carried no `Message.sender` and the actions surface had no address to answer — a
   * refusal or an error had nowhere to go but a toast. A send made from this machine carries the code
   * surface's ref, because the shell names a surface while it handles anything (`notifySurfaceActor`).
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
      enqueue.spawnChild('openAction', { id: `open.${++asks}`, input: { actionId } })
    }),

    saveAction: enqueueActions(({ enqueue, event }) => {
      const ev = typeOf('codeActions.SAVE_ACTION', event)
      enqueue.spawnChild('saveAction', { id: `save.${++asks}`, input: { actionId: ev.actionId, actionFn: ev.content } })
    }),

    // An ask that ended is no longer this machine's child
    forgetAsk: enqueueActions(({ enqueue, event }) => {
      enqueue.stopChild((event as DoneActorEvent).actorId)
    }),

    // The action opens in a tab. One that could not be opened opens none
    handleActionSelected: ({ event, self }) => {
      const { output } = event as DoneActorEvent<OutputFrom<typeof openAction>>
      if (!output.ok) return
      const data = output.value
      const ev = { actionId: data.id as string, data }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []
      const actionPath = `action:${ev.actionId}`

      // Check if action tab already exists
      const existingTab = openFiles.find((f: any) => f.path === actionPath)

      if (existingTab) {
        // Tab already exists, just activate it
        updateParentState(self, {
          activeFilePath: actionPath
        })
      } else {
        // Create new action tab
        const actionTab: ActionTab = {
          path: actionPath,
          content: ev.data.actionFnContent || ev.data.actionFn || '',
          modified: false,
          isAction: true,
          actionEntity: ev.data
        }
        addTabToParent(self, actionTab, true)
      }
    },

    // The saved action replaces the one its tab holds. One that could not be saved leaves the tab modified
    updateActionInOpenFiles: ({ event, self }) => {
      const { output } = event as DoneActorEvent<OutputFrom<typeof saveAction>>
      if (!output.ok) return
      const action = output.value
      const ev = { action, actionId: action.id as string }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []

      // Update the action entity in the open tab
      const updatedFiles = openFiles.map((file: any) => {
        if (file.isAction && file.actionEntity.id === ev.actionId) {
          return {
            ...file,
            actionEntity: ev.action,
            modified: false
          }
        }
        return file
      })

      updateParentState(self, { openFiles: updatedFiles })
    },

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

    // Handle tab restoration
    openActionTabs: enqueueActions(({ enqueue, event }) => {
      // Open each action
      for (const actionId of typeOf('codeActions.OPEN_TABS', event).actionIds) {
        enqueue.spawnChild('openAction', { id: `open.${++asks}`, input: { actionId } })
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
    'xstate.done.actor.open.*': { actions: ['handleActionSelected', 'forgetAsk'] },
    'xstate.done.actor.save.*': { actions: ['updateActionInOpenFiles', 'forgetAsk'] },
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
