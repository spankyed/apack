import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { toMap, toIdentifierSet, mapScalar } from '@apackdev/sdk/utils';
import { exportPrompts } from './repository/export-prompts.ts';

import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('prompts');

export const promptsSpec = defineSystem<Contract>();

/**
 * The prompts system writes prompts. What a window shows of them is the feature's views (`views.ts`), which run
 * again after each of these writes, so nothing here says who is looking.
 */
/**
 * A window's writes to its prompts and its imports and exports, each answered to whoever asked: what it did, or why
 * it could not be done
 */
export const answers = promptsSpec.answers({
  CREATE_PROMPT: ({ args }) => {
    repository.promptCommands.create({
      label: args.label,
      inputs: args.inputs,
      templateFn: args.templateFn,
      outputSchema: args.outputSchema,
      description: args.description,
      category: args.category
    });
  },
  UPDATE_PROMPT: ({ args }) => {
    const updates: Record<string, any> = {};

    if (args.label !== undefined) updates.label = args.label;
    if (args.inputs !== undefined) updates.inputs = args.inputs;
    if (args.templateFn !== undefined) updates.templateFn = args.templateFn;
    if (args.outputSchema !== undefined) updates.outputSchema = args.outputSchema;
    if (args.description !== undefined) updates.description = args.description;
    if (args.category !== undefined) updates.category = args.category;

    repository.promptCommands.update(args.promptId as EARS.EntityId, updates);
  },
  DELETE_PROMPT: ({ args }) => {
    repository.promptCommands.delete(args.promptId as EARS.EntityId);
  },
  IMPORT_PROMPTS: ({ args: { prompts: importData } }) => {
    logger.info('Importing prompts', { count: Array.isArray(importData) ? importData.length : 0 });

    if (!Array.isArray(importData)) throw new Error('Invalid import data: expected an array of prompts');

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
        errors.push(`Failed to create prompt "${item.label}": ${errorMessage(err)}`);
      }
    }

    if (count === 0 && errors.length > 0) throw new Error(errors.join('\n'));

    logger.info('Prompts import complete', { count, errors: errors.length });
    return { count, ...(errors.length > 0 ? { errors } : {}) };
  },
  EXPORT_PROMPTS: ({ args: { directory } }) => {
    logger.info('Exporting prompts', { directory });
    const exported = exportPrompts(directory);
    logger.info('Prompts export complete', exported);
    return exported;
  },
})

export const promptsSystem = setup({
  types: promptsSpec.types,
  actions: { ...answers.actions, ...promptsSpec.actions({
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
  }) },
}).createMachine(
  {
    id: 'prompts',
    initial: 'idle',
    context: () => ({}),
    on: {
      ...answers.on,
      FEATURE_SETTINGS_UPDATED: {
        actions: 'handleSettingsUpdate',
      },
    },
    states: {
      idle: {},
    },
  }
);

const promptsEntry = { spec: promptsSpec, machine: promptsSystem };

export default promptsEntry;
