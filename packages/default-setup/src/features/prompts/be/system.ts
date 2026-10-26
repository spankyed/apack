import { broadcastToSurface } from '#generated/events.ts';
import { setup } from 'xstate';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingPromptEvents } from './types.ts';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { toMap, toIdentifierSet, mapScalar } from '@apackdev/sdk/utils';
import { exportPrompts } from './repository/export-prompts.ts';

/** What may fall back to every window: a command's outcome, which someone must hear, and never data a window shows */
type OutcomeType = 'PROMPTS_EXPORT_FAILED' | 'PROMPTS_EXPORTED' | 'PROMPTS_IMPORT_FAILED' | 'PROMPTS_IMPORTED'
type Outcome = Extract<OutgoingPromptEvents, { type: OutcomeType }>

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. The
 * prompts the import wrote reach every window through its views.
 */
const answer = (reply: Reply<OutgoingPromptEvents> | undefined, event: Outcome): void =>
  (reply ? reply(event) : broadcastToSurface('prompts', event));
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('prompts');

export const promptsSpec = defineSystem<Contract>();

/**
 * The prompts system writes prompts. What a window shows of them is the feature's views (`views.ts`), which run
 * again after each of these writes, so nothing here says who is looking.
 */
export const promptsSystem = setup({
  types: promptsSpec.types,
  actions: promptsSpec.actions({
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

      // A removed category leaves its prompts in none
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
    on: {
      CREATE_PROMPT: {
        actions: 'createPrompt',
      },
      UPDATE_PROMPT: {
        actions: 'updatePrompt',
      },
      DELETE_PROMPT: {
        actions: 'deletePrompt',
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
      idle: {},
    },
  }
);

const promptsEntry = { spec: promptsSpec, machine: promptsSystem };

export default promptsEntry;
