import type { PromptTab } from '../../contract.ts';
export type { PromptTab } from '../../contract.ts';
import { setup, enqueueActions, type ActorRefFrom, type DoneActorEvent, type OutputFrom } from 'xstate';
import { sendToSurface, fromAsk } from '#generated/events.ts';
import { safeEvents } from '@apackdev/sdk/helpers';
import { updateParentState, getParentContext, addTabToParent } from '../../utils/parent-communication.ts';
import type { EARS } from '#generated/ears.ts';

// The asks about a prompt's template. Several run at once, one per tab opening or saving, so each is spawned under
// an id of its own (`open.<n>`, `save.<n>`) and its outcome arrives as that actor's done event
const openPrompt = fromAsk('code', 'codePrompts.OPEN_PROMPT');
const savePrompt = fromAsk('code', 'codePrompts.SAVE_PROMPT');
let asks = 0;

export type Event =
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
  | { type: 'codePrompts.SAVE_PROMPT'; promptId: string; content: string }
  // How an ask about a prompt's template ended
  | DoneActorEvent<OutputFrom<typeof openPrompt>, `open.${number}`>
  | DoneActorEvent<OutputFrom<typeof savePrompt>, `save.${number}`>
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

const typeOf = safeEvents<Event>();

export const promptsState = setup({
  types: {
    context: {} as Record<string, never>,
    events: {} as Event
  },
  actors: { openPrompt, savePrompt },
  actions: {
    openPrompt: enqueueActions(({ enqueue, event }) => {
      const { promptId } = typeOf('codePrompts.OPEN_PROMPT', event)
      enqueue.spawnChild('openPrompt', { id: `open.${++asks}`, input: { promptId } })
    }),

    savePrompt: enqueueActions(({ enqueue, event }) => {
      const ev = typeOf('codePrompts.SAVE_PROMPT', event)
      enqueue.spawnChild('savePrompt', { id: `save.${++asks}`, input: { promptId: ev.promptId, templateFn: ev.content } })
    }),

    // An ask that ended is no longer this machine's child
    forgetAsk: enqueueActions(({ enqueue, event }) => {
      enqueue.stopChild((event as DoneActorEvent).actorId)
    }),

    // The prompt opens in a tab. One that could not be opened opens none
    handlePromptSelected: ({ event, self }) => {
      const { output } = event as DoneActorEvent<OutputFrom<typeof openPrompt>>
      if (!output.ok) return
      const data = output.value
      const ev = { promptId: data.id as string, data }
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

    // The saved prompt replaces the one its tab holds. One that could not be saved leaves the tab modified
    updatePromptInOpenFiles: ({ event, self }) => {
      const { output } = event as DoneActorEvent<OutputFrom<typeof savePrompt>>
      if (!output.ok) return
      const prompt = output.value
      const ev = { prompt, promptId: prompt.id as string }
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
      const ev = typeOf('codePrompts.UPDATE_INPUTS', event)
      sendToSurface('prompts', { type: 'PROMPT.UPDATE_INPUTS', promptId: ev.promptId, inputs: ev.inputs })
    },

    updatePromptLabel: ({ event }) => {
      const ev = typeOf('codePrompts.UPDATE_LABEL', event)
      sendToSurface('prompts', { type: 'PROMPT.UPDATE_LABEL', promptId: ev.promptId, label: ev.label })
    },

    deletePrompt: ({ event }) => {
      const ev = typeOf('codePrompts.DELETE', event)
      sendToSurface('prompts', { type: 'PROMPT.DELETE', promptId: ev.promptId })
    },

    createPromptInline: ({ event }) => {
      const ev = typeOf('codePrompts.CREATE_INLINE', event)
      sendToSurface('prompts', { type: 'PROMPT.CREATE_INLINE', label: ev.label, templateFn: ev.templateFn, inputs: ev.inputs })
    },

    // Handle tab restoration
    openPromptTabs: enqueueActions(({ enqueue, event }) => {
      // Open each prompt
      for (const promptId of typeOf('codePrompts.OPEN_TABS', event).promptIds) {
        enqueue.spawnChild('openPrompt', { id: `open.${++asks}`, input: { promptId } })
      }
    })
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
    // How its asks ended
    'xstate.done.actor.open.*': { actions: ['handlePromptSelected', 'forgetAsk'] },
    'xstate.done.actor.save.*': { actions: ['updatePromptInOpenFiles', 'forgetAsk'] },
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
