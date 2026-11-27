// A prompt's template as the code surface edits it in a tab: opened from the prompt, and saved back into it
import type { PromptsAsks } from '../contract.ts';
import type { NormalizeAsks } from '@apackdev/sdk/events';
import { state } from '#generated/state.ts';
import { repository } from '#generated/repository.ts';
import { EARS } from '#generated/ears.ts';

/** The code system's child for prompts' templates. It holds nothing: its asks are answered from the prompts' repository */
export const promptsSystem = state<{}, never, NormalizeAsks<PromptsAsks>>()({
  answers: {
    'codePrompts.OPEN_PROMPT': ({ promptId }, { refuse }) => {
      const prompt = repository.promptQueries.byId(promptId as EARS.EntityId);
      if (!prompt) throw refuse('not-found', `Prompt ${promptId} not found`);
      return { ...prompt, templateFnContent: prompt.templateFn };
    },
    'codePrompts.SAVE_PROMPT': ({ promptId, templateFn }, { refuse }) => {
      repository.promptCommands.update(promptId as EARS.EntityId, { templateFn });
      const updated = repository.promptQueries.byId(promptId as EARS.EntityId);
      if (!updated) throw refuse('not-found', `Prompt ${promptId} not found`);
      return updated;
    },
  },
});
