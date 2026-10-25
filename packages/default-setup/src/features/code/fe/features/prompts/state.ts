import type { PromptTab } from '../../contract.ts';
export type { PromptTab } from '../../contract.ts';
import { setup , type ActorRefFrom } from 'xstate';
import { sendToSurface, sendToSystem } from '#generated/events.ts';
import { updateParentState, getParentContext, addTabToParent } from '../../utils/parent-communication.ts';
import type { PromptEntity } from '@apackdev/sdk';
import type { EARS } from '#generated/ears.ts';


export type Event =
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
  | { type: 'codePrompts.SAVE_PROMPT'; promptId: string; content: string }
  // Backend events
  | { type: 'codePrompts.PROMPT_SELECTED'; promptId: string; data: PromptEntity & { templateFnContent?: string } }
  | { type: 'codePrompts.PROMPT_UPDATED'; prompt: PromptEntity; promptId: string }
  // Tab restoration
  | { type: 'codePrompts.OPEN_TABS'; promptIds: string[] }
  /**
   * What the panel asks of the **prompts surface**: its edits, which that surface sends its system.
   *
   * The panel used to send these straight to that surface from its click handlers. Two things were wrong
   * with that and the second is why they are here rather than merely tidier: a component is not inside any
   * delivery, so the send carried no `Message.sender` and the prompts surface had no address to answer — a
   * refusal or an error had nowhere to go but a toast. A send made from this machine carries the code
   * surface's ref, because the shell names a surface while it handles anything (`notifySurfaceActor`).
   *
   * The names match what they forward, so the hand-off reads as one; the `codePrompts.` prefix is how the
   * code surface routes an event to this child.
   */
  | { type: 'codePrompts.UPDATE_INPUTS'; promptId: string; inputs: Record<string, unknown> }
  | { type: 'codePrompts.UPDATE_LABEL'; promptId: string; label: string }
  | { type: 'codePrompts.DELETE'; promptId: EARS.EntityId }
  | { type: 'codePrompts.CREATE_INLINE'; label: string; templateFn: string; inputs: Record<string, unknown> };

export const promptsState = setup({
  types: {
    context: {} as Record<string, never>,
    events: {} as Event
  },
  actions: {
    openPrompt: ({ event }) => {
      const ev = event as { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
      sendToSystem('code', { type: 'codePrompts.OPEN_PROMPT', promptId: ev.promptId })
    },

    savePrompt: ({ event }) => {
      const ev = event as { type: 'codePrompts.SAVE_PROMPT'; promptId: string; content: string }
      sendToSystem('code', {
        type: 'codePrompts.SAVE_PROMPT',
        promptId: ev.promptId,
        templateFn: ev.content,
      })
    },

    handlePromptSelected: ({ event, self }) => {
      const ev = event as { type: 'codePrompts.PROMPT_SELECTED'; promptId: string; data: PromptEntity & { templateFnContent?: string } }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []
      const promptPath = `prompt:${ev.promptId}`

      // Check if prompt tab already exists
      const existingTab = openFiles.find((f: any) => f.path === promptPath)

      if (existingTab) {
        // Tab already exists, just activate it
        updateParentState(self, {
          activeFilePath: promptPath
        })
      } else {
        // Create new prompt tab
        const promptTab: PromptTab = {
          path: promptPath,
          content: ev.data.templateFnContent || ev.data.templateFn || '',
          modified: false,
          isPrompt: true,
          promptEntity: ev.data
        }
        addTabToParent(self, promptTab, true)
      }
    },

    updatePromptInOpenFiles: ({ event, self }) => {
      const ev = event as { type: 'codePrompts.PROMPT_UPDATED'; prompt: PromptEntity; promptId: string }
      const parentContext = getParentContext(self)
      const openFiles = parentContext?.openFiles || []

      // Update the prompt entity in the open tab
      const updatedFiles = openFiles.map((file: any) => {
        if (file.isPrompt && file.promptEntity.id === ev.promptId) {
          return {
            ...file,
            promptEntity: ev.prompt,
            modified: false
          }
        }
        return file
      })

      updateParentState(self, { openFiles: updatedFiles })
    },


    // The panel's asks of the prompts surface, forwarded from here so each one carries a sender
    updatePromptInputs: ({ event }) => {
      const ev = event as { type: 'codePrompts.UPDATE_INPUTS'; promptId: string; inputs: Record<string, unknown> }
      sendToSurface('prompts', { type: 'PROMPT.UPDATE_INPUTS', promptId: ev.promptId, inputs: ev.inputs })
    },

    updatePromptLabel: ({ event }) => {
      const ev = event as { type: 'codePrompts.UPDATE_LABEL'; promptId: string; label: string }
      sendToSurface('prompts', { type: 'PROMPT.UPDATE_LABEL', promptId: ev.promptId, label: ev.label })
    },

    deletePrompt: ({ event }) => {
      const ev = event as { type: 'codePrompts.DELETE'; promptId: EARS.EntityId }
      sendToSurface('prompts', { type: 'PROMPT.DELETE', promptId: ev.promptId })
    },

    createPromptInline: ({ event }) => {
      const ev = event as { type: 'codePrompts.CREATE_INLINE'; label: string; templateFn: string; inputs: Record<string, unknown> }
      sendToSurface('prompts', { type: 'PROMPT.CREATE_INLINE', label: ev.label, templateFn: ev.templateFn, inputs: ev.inputs })
    },

    // Handle tab restoration
    openPromptTabs: ({ event }) => {
      const ev = event as { type: 'codePrompts.OPEN_TABS'; promptIds: string[] }
      // Open each prompt
      ev.promptIds.forEach(promptId => {
        sendToSystem('code', { type: 'codePrompts.OPEN_PROMPT', promptId })
      })
    }
  }
}).createMachine({
  id: 'codePrompts',
  initial: 'idle',
  context: {},
  on: {
    'codePrompts.OPEN_PROMPT': {
      actions: 'openPrompt'
    },
    'codePrompts.SAVE_PROMPT': {
      actions: 'savePrompt'
    },
    'codePrompts.OPEN_TABS': {
      actions: 'openPromptTabs'
    },
    // Backend events
    'codePrompts.PROMPT_SELECTED': {
      actions: 'handlePromptSelected'
    },
    'codePrompts.PROMPT_UPDATED': {
      actions: 'updatePromptInOpenFiles'
    },
    // The panel's asks of the prompts surface
    'codePrompts.UPDATE_INPUTS': { actions: 'updatePromptInputs' },
    'codePrompts.UPDATE_LABEL': { actions: 'updatePromptLabel' },
    'codePrompts.DELETE': { actions: 'deletePrompt' },
    'codePrompts.CREATE_INLINE': { actions: 'createPromptInline' }
  },
  states: {
    idle: {}
  }
})

/** The prompts child's actor, named by whoever reads its context (`codeChild(…)`) */
export type CodePromptsActor = ActorRefFrom<typeof promptsState>;
