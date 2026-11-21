// A prompt's template as the code surface edits it in a tab: opened from the prompt, and saved back into it
import type { PromptsAsks } from '../contract.ts'
import { defineHandlers } from '@apackdev/sdk/framework'
import type { AsksEvents } from '@apackdev/sdk/events'
import { setup } from 'xstate'
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'

// The asks about a prompt's template, which the code system forwards here to be answered
export type Event = AsksEvents<PromptsAsks>;

const handlers = defineHandlers<Record<string, never>, Event>();

/** The asks about a prompt's template, answered here from the prompts' repository */
const answers = handlers.answers<PromptsAsks>({
  'codePrompts.OPEN_PROMPT': ({ args: { promptId }, refuse }) => {
    const prompt = repository.promptQueries.byId(promptId as EARS.EntityId)
    if (!prompt) throw refuse('not-found', `Prompt ${promptId} not found`)
    return { ...prompt, templateFnContent: prompt.templateFn }
  },
  'codePrompts.SAVE_PROMPT': ({ args: { promptId, templateFn }, refuse }) => {
    repository.promptCommands.update(promptId as EARS.EntityId, { templateFn })
    const updated = repository.promptQueries.byId(promptId as EARS.EntityId)
    if (!updated) throw refuse('not-found', `Prompt ${promptId} not found`)
    return updated
  },
});

/** The code system's child for prompts' templates. It holds nothing: its id is the prefix its asks are forwarded by */
export const promptsSystem = setup({
  types: {
    context: {} as Record<string, never>,
    events: {} as Event,
  },
  actions: { ...answers.actions },
}).createMachine({
  id: 'codePrompts',
  context: {},
  on: { ...answers.on },
})
