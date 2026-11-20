// A prompt's template as the code surface edits it in a tab: opened from the prompt, and saved back into it
import type { AnswersTo, PromptsAsks } from '../contract.ts'
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts'

/** The asks about a prompt's template, answered by the code system (`answers`, `system.ts`) */
export const promptsAnswers: AnswersTo<PromptsAsks> = {
  'codePrompts.OPEN_PROMPT': ({ ask: { promptId }, failure }) => {
    const prompt = repository.promptQueries.byId(promptId as EARS.EntityId)
    if (!prompt) throw failure('not-found', `Prompt ${promptId} not found`)
    return { ...prompt, templateFnContent: prompt.templateFn }
  },
  'codePrompts.SAVE_PROMPT': ({ ask: { promptId, templateFn }, failure }) => {
    repository.promptCommands.update(promptId as EARS.EntityId, { templateFn })
    const updated = repository.promptQueries.byId(promptId as EARS.EntityId)
    if (!updated) throw failure('not-found', `Prompt ${promptId} not found`)
    return updated
  },
}
