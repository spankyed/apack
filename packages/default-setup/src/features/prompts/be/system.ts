import { featureSettings } from '#generated/settings.ts';

import { broadcastToSurface } from '#generated/events.ts';
import { isDeepStrictEqual } from 'node:util';
import { fromCallback, setup } from 'xstate';
import { subscribe } from '@apackdev/sdk/ears';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingPromptEvents } from './types.ts';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { toMap, toIdentifierSet, mapScalar } from '@apackdev/sdk/utils';
import { exportPrompts } from './repository/export-prompts.ts';

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. The
 * data the import changed is separate news and stays a broadcast.
 */
const answer = (reply: Reply<OutgoingPromptEvents> | undefined, event: OutgoingPromptEvents): void =>
  (reply ? reply(event) : broadcastToSurface('prompts', event));
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('prompts');

/**
 * The prompts as every window's list holds them, kept current: a live query on every prompt, whose changes are told to
 * the surface as the prompt created, updated or deleted — whoever wrote it: this system, a content apply, an action,
 * the Database console or `apack db`. No command here announces its own write.
 */
const followPrompts = fromCallback(() => {
  let previous: Map<string, unknown> | undefined;
  return subscribe(() => repository.promptQueries.all(), (prompts) => {
    const next = new Map(prompts.map((prompt) => [prompt.id as string, prompt]));
    // The first answer is what the surface asks for when it connects (`SEND_STATE`), not a change
    if (previous) {
      for (const prompt of prompts) {
        const before = previous.get(prompt.id);
        if (before === undefined) broadcastToSurface('prompts', { type: 'PROMPT_CREATED', prompt, promptId: prompt.id });
        else if (!isDeepStrictEqual(before, prompt)) broadcastToSurface('prompts', { type: 'PROMPT_UPDATED', prompt, promptId: prompt.id });
      }
      for (const id of previous.keys()) {
        if (!next.has(id)) broadcastToSurface('prompts', { type: 'PROMPT_DELETED', promptId: id as EARS.EntityId });
      }
    }
    previous = next;
  });
});

export const promptsSpec = defineSystem<Contract>();

export const promptsSystem = setup({
  types: promptsSpec.types,
  actors: { followPrompts },
  actions: promptsSpec.actions({
    sendPromptsConnectedData: () => {
      const connectedData = repository.promptQueries.connectedData();
      const promptsSettings = featureSettings.forFeature('prompts').get();
      
      broadcastToSurface('prompts', { 
        type: 'PROMPTS_CONNECTED',
        data: {
          ...connectedData,
          categories: promptsSettings?.categories || []
        }
      });
    },
    /**
     * **Answered, not broadcast**, because a broadcast cannot be correlated by anything this event carries.
     * Sent to every window's prompts surface it would be admitted on the prompt id alone, so two windows
     * looking at the same prompt would each accept the other's answer, and a window that had moved on since
     * asking would take an answer it was no longer waiting for. `reply` sends to the asker on the connection
     * they asked from, and the call names the ask within it.
     *
     * `promptId` stays on the event because the view needs it — it is the row's identity, not the
     * correlation. What tells one answer from another is `Message.answering`.
     */
    sendPromptData: ({ event, reply }) => {
      const ev = promptsSpec.typeOf('PROMPT_SELECT', event);
      const prompt = repository.promptQueries.byId(ev.promptId as EARS.EntityId);

      if (prompt) {
        reply?.({
          type: 'PROMPT_SELECTED',
          promptId: ev.promptId as EARS.EntityId,
          data: prompt
        });
      }
    },
    createPrompt: ({ event }) => {
      const ev = promptsSpec.typeOf('CREATE_PROMPT', event);
      repository.promptCommands.create({
        label: ev.label,
        inputs: ev.inputs,
        templateFn: ev.templateFn,
        outputSchema: ev.outputSchema,
        description: ev.description,
        category: ev.category
      });
    },
    updatePrompt: ({ event }) => {
      const ev = promptsSpec.typeOf('UPDATE_PROMPT', event);
      const updates: Record<string, any> = {};
      
      if (ev.label !== undefined) updates.label = ev.label;
      if (ev.inputs !== undefined) updates.inputs = ev.inputs;
      if (ev.templateFn !== undefined) updates.templateFn = ev.templateFn;
      if (ev.outputSchema !== undefined) updates.outputSchema = ev.outputSchema;
      if (ev.description !== undefined) updates.description = ev.description;
      if (ev.category !== undefined) updates.category = ev.category;
      
      repository.promptCommands.update(ev.promptId as EARS.EntityId, updates);
    },
    deletePrompt: ({ event }) => {
      const ev = promptsSpec.typeOf('DELETE_PROMPT', event);
      repository.promptCommands.delete(ev.promptId as EARS.EntityId);
    },
    fetchPromptsPage: ({ event }) => {
      const ev = promptsSpec.typeOf('FETCH_PROMPTS_PAGE', event);
      const data = repository.promptQueries.connectedData(ev.page || 1);

      broadcastToSurface('prompts', {
        type: 'PROMPTS_PAGE_LOADED',
        data: {
          prompts: data.prompts,
          page: data.page,
          totalPages: data.totalPages
        }
      });
    },
    fetchAllPrompts: () => {
      const allPrompts = repository.promptQueries.all();
      broadcastToSurface('prompts', {
        type: 'PROMPTS_ALL_LOADED',
        data: { prompts: allPrompts }
      });
    },
    importPrompts: ({ event, reply }) => {
      const { prompts: importData } = promptsSpec.typeOf('IMPORT_PROMPTS', event);

      logger.info('Importing prompts', { count: Array.isArray(importData) ? importData.length : 0 });

      if (!Array.isArray(importData)) {
        answer(reply, {
          type: 'PROMPTS_IMPORT_FAILED',
          errors: ['Invalid import data: expected an array of prompts'],
        });
        return;
      }

      const errors: string[] = [];
      let count = 0;

      for (let i = 0; i < importData.length; i++) {
        const item = importData[i];
        if (!item.label || !item.templateFn) {
          errors.push(`Prompt at index ${i} is missing required fields (label, templateFn)`);
          continue;
        }

        try {
          repository.promptCommands.create({
            label: item.label,
            inputs: item.inputs || {},
            templateFn: item.templateFn,
            outputSchema: item.outputSchema,
            description: item.description,
            category: item.category,
          });
          count++;
        } catch (err) {
          const message = errorMessage(err);
          errors.push(`Failed to create prompt "${item.label}": ${message}`);
        }
      }

      if (count === 0 && errors.length > 0) {
        answer(reply, {
          type: 'PROMPTS_IMPORT_FAILED',
          errors,
        });
        return;
      }

      answer(reply, {
        type: 'PROMPTS_IMPORTED',
        count,
        ...(errors.length > 0 ? { errors } : {}),
      });

      logger.info('Prompts import complete', { count, errors: errors.length });
    },

    exportPromptsToFile: ({ event, reply }) => {
      const { directory } = promptsSpec.typeOf('EXPORT_PROMPTS', event);

      logger.info('Exporting prompts', { directory });

      try {
        const { filePath, promptCount } = exportPrompts(directory);

        answer(reply, {
          type: 'PROMPTS_EXPORTED',
          filePath,
          promptCount,
        });

        logger.info('Prompts export complete', { filePath, promptCount });
      } catch (error) {
        const message = errorMessage(error);
        logger.error('Prompts export failed', { error: message });

        answer(reply, {
          type: 'PROMPTS_EXPORT_FAILED',
          errors: [message],
        });
      }
    },

    handleSettingsUpdate: ({ event }) => {
      const { changes } = promptsSpec.typeOf('FEATURE_SETTINGS_UPDATED', event);
      const categoryChanges = changes?.categories;
      
      if (!categoryChanges) return;
      
      const renames = toMap(categoryChanges.renames);
      // Categories use 'name' property as identifier
      const removed = toIdentifierSet(categoryChanges.removed, (item: any) => item.name);
      
      if (!renames.size && !removed.size) return;
      
      // Fallback to first available category or 'General'
      const emptyCategoryName = (): string | undefined => '';
      
      
      for (const p of repository.promptQueries.all()) {
        const nextCategory = mapScalar(p.category, renames, removed, emptyCategoryName);
        
        if (nextCategory !== p.category) repository.promptCommands.update(p.id, { category: nextCategory });
      }
    },
  }),
}).createMachine(
  {
    id: 'prompts',
    initial: 'idle',
    context: () => ({}),
    invoke: { src: 'followPrompts' },
    on: {
      PROMPT_SELECT: {
        actions: 'sendPromptData',
      },
      CREATE_PROMPT: {
        actions: 'createPrompt',
      },
      UPDATE_PROMPT: {
        actions: 'updatePrompt',
      },
      DELETE_PROMPT: {
        actions: 'deletePrompt',
      },
      FETCH_PROMPTS_PAGE: {
        actions: 'fetchPromptsPage',
      },
      FETCH_ALL_PROMPTS: {
        actions: 'fetchAllPrompts',
      },
      FEATURE_SETTINGS_UPDATED: {
        actions: 'handleSettingsUpdate',
      },
      IMPORT_PROMPTS: {
        actions: 'importPrompts',
      },
      EXPORT_PROMPTS: {
        actions: 'exportPromptsToFile',
      },
    },
    states: {
      idle: {
        on: {
          SEND_STATE: {
            actions: 'sendPromptsConnectedData',
          },
        },
      },
    },
  }
);

const promptsEntry = { spec: promptsSpec, machine: promptsSystem };

export default promptsEntry;