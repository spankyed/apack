import type { PromptTab } from '../../contract.ts';
export type { PromptTab } from '../../contract.ts';
import { setup, enqueueActions, type ActorRefFrom, type AnyActorRef, type OutputFrom } from 'xstate';
import { sendToSurface, fromAsk } from '#generated/events.ts';
import { safeEvents } from '@apackdev/sdk/helpers';
import { freshKey, makes, type MadeEvent, type Making } from '@apackdev/sdk/fe';
import { showTabInParent, updateTabsInParent } from '../../utils/parent-tabs.ts';
import type { EARS } from '#generated/ears.ts';

// The asks about a prompt's template. Several run at once, one per tab opening or saving, so each is made under a key
// of its own
const openPrompt = fromAsk('code', 'codePrompts.OPEN_PROMPT');
const savePrompt = fromAsk('code', 'codePrompts.SAVE_PROMPT');
const made = makes(({ each }) => ({ open: each(openPrompt), save: each(savePrompt) }));

export interface CodePromptsContext {
  /** Which of the asks the machine makes (`made`) are under way */
  making: Making<typeof made>
}

/** The prompt opens in a tab. One that could not be opened opens none */
function showOpenedPrompt(self: AnyActorRef, output: OutputFrom<typeof openPrompt>): void {
  if (!output.ok) return
  const prompt = output.value
  const tab: PromptTab = {
    path: `prompt:${prompt.id}`,
    content: prompt.templateFnContent || prompt.templateFn || '',
    modified: false,
    isPrompt: true,
    promptEntity: prompt,
  }
  showTabInParent(self, tab)
}

/** The saved prompt replaces the one its tab holds. One that could not be saved leaves the tab modified */
function takeSavedPrompt(self: AnyActorRef, output: OutputFrom<typeof savePrompt>): void {
  if (!output.ok) return
  const prompt = output.value
  updateTabsInParent(self, file => file.isPrompt && file.promptEntity.id === prompt.id
    ? { ...file, promptEntity: prompt, modified: false }
    : file)
}

export type Event =
  | { type: 'codePrompts.OPEN_PROMPT'; promptId: string }
  | { type: 'codePrompts.SAVE_PROMPT'; promptId: string; content: string }
  // How an ask about a prompt's template ended
  | MadeEvent<typeof made>
  // Tab restoration
  | { type: 'codePrompts.OPEN_TABS'; promptIds: string[] }
  /**
   * What the panel asks of the **prompts surface**: its edits, which that surface sends its system.
   *
   * Sent from this machine rather than from the panel's click handlers: a component is not inside any delivery,
   * so a send it makes carries no `Message.sender` and the prompts surface has no address to answer a refusal or
   * an error to. A send made from this machine carries the code surface's ref, because the shell names a surface
   * while it handles anything (`notifySurfaceActor`).
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
    context: {} as CodePromptsContext,
    events: {} as Event
  },
  actors: made.actors,
  actions: {
    openPrompt: enqueueActions(({ enqueue, event }) => {
      const { promptId } = typeOf('codePrompts.OPEN_PROMPT', event)
      made.make(enqueue, 'open', freshKey(), { promptId })
    }),

    savePrompt: enqueueActions(({ enqueue, event }) => {
      const ev = typeOf('codePrompts.SAVE_PROMPT', event)
      made.make(enqueue, 'save', freshKey(), { promptId: ev.promptId, templateFn: ev.content })
    }),

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

    /** The tabs a restore had open: one ask for each prompt */
    openPromptTabs: enqueueActions(({ enqueue, event }) => {
      for (const promptId of typeOf('codePrompts.OPEN_TABS', event).promptIds) {
        made.make(enqueue, 'open', freshKey(), { promptId })
      }
    })
  }
}).createMachine({
  id: 'codePrompts',
  initial: 'idle',
  context: { making: made.none() },
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
    [made.done]: { actions: made.settle() },
    'made.open': { actions: ({ event, self }) => showOpenedPrompt(self, event.outcome) },
    'made.save': { actions: ({ event, self }) => takeSavedPrompt(self, event.outcome) },
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
