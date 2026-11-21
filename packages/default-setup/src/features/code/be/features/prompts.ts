// A prompt's template as the code surface edits it in a tab: opened from the prompt, and saved back into it
import type { AnswersTo, PromptsAsks } from '../contract.ts'
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'

/** The asks about a prompt's template, answered by the code system (`answers`, `system.ts`) */
export const promptsAnswers: AnswersTo<PromptsAsks> = {
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
}
