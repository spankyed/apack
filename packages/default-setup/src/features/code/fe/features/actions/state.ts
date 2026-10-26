import type { ActionTab } from '../../contract.ts';
export type { ActionTab } from '../../contract.ts';
import { setup , type ActorRefFrom } from 'xstate';
import { sendToSurface, sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent } from '../../utils/parent-communication.ts';
import type { ActionEntity } from '@apackdev/sdk';
import type { EARS } from '#generated/ears.ts';


export type Event =
  | { type: 'codeActions.OPEN_ACTION'; actionId: string }
  | { type: 'codeActions.SAVE_ACTION'; actionId: string; content: string }
  // Backend events
  | { type: 'codeActions.ACTION_SELECTED'; actionId: string; data: ActionEntity & { actionFnContent?: string } }
  | { type: 'codeActions.ACTION_UPDATED'; action: ActionEntity; actionId: string }
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

export const actionsState = setup({
  types: {
    context: {} as Record<string, never>,
    events: {} as Event
  },
  actions: {
    openAction: ({ event }) => {
      const ev = event as { type: 'codeActions.OPEN_ACTION'; actionId: string }
      sendToSystem('code', { type: 'codeActions.OPEN_ACTION', actionId: ev.actionId })
    },

    saveAction: ({ event }) => {
      const ev = event as { type: 'codeActions.SAVE_ACTION'; actionId: string; content: string }
      sendToSystem('code', {
        type: 'codeActions.SAVE_ACTION',
        actionId: ev.actionId,
        actionFn: ev.content,
      })
    },

    handleActionSelected: ({ event, self }) => {
      const ev = event as { type: 'codeActions.ACTION_SELECTED'; actionId: string; data: ActionEntity & { actionFnContent?: string } }
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

    updateActionInOpenFiles: ({ event, self }) => {
      const ev = event as { type: 'codeActions.ACTION_UPDATED'; action: ActionEntity; actionId: string }
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
      const ev = event as { type: 'codeActions.UPDATE_INPUT'; actionId: string; input: Record<string, unknown> }
      sendToSurface('actions', { type: 'ACTION.UPDATE_INPUT', actionId: ev.actionId, input: ev.input })
    },

    updateActionLabel: ({ event }) => {
      const ev = event as { type: 'codeActions.UPDATE_LABEL'; actionId: string; label: string }
      sendToSurface('actions', { type: 'ACTION.UPDATE_LABEL', actionId: ev.actionId, label: ev.label })
    },

    deleteAction: ({ event }) => {
      const ev = event as { type: 'codeActions.DELETE'; actionId: EARS.EntityId }
      sendToSurface('actions', { type: 'ACTION.DELETE', actionId: ev.actionId })
    },

    createActionInline: ({ event }) => {
      const ev = event as { type: 'codeActions.CREATE_INLINE'; label: string; actionFn: string; input: Record<string, unknown> }
      sendToSurface('actions', { type: 'ACTION.CREATE_INLINE', label: ev.label, actionFn: ev.actionFn, input: ev.input })
    },

    // Handle tab restoration
    openActionTabs: ({ event }) => {
      const ev = event as { type: 'codeActions.OPEN_TABS'; actionIds: string[] }
      // Open each action
      ev.actionIds.forEach(actionId => {
        sendToSystem('code', { type: 'codeActions.OPEN_ACTION', actionId })
      })
    }
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
    // Backend events
    'codeActions.ACTION_SELECTED': {
      actions: 'handleActionSelected'
    },
    'codeActions.ACTION_UPDATED': {
      actions: 'updateActionInOpenFiles'
    },
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
