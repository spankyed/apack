import { featureSettings } from '#generated/settings.ts';

import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { toMap, toIdentifierSet, mapScalar } from '@apackdev/sdk/utils';
import { exportActions } from './repository/export-actions.ts';

import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('actions');

export const actionsSpec = defineSystem<Contract>();

/**
 * The actions system writes actions. What a window shows of them is the feature's views (`views.ts`) — the actions
 * surface's list and open action, and the flows editor's palette — which run again after each of these writes, so
 * nothing here says who is looking.
 */
/**
 * A window's writes to its actions and its imports and exports, each answered to whoever asked: what it did, or why
 * it could not be done
 */
export const answers = actionsSpec.answers({
  CREATE_ACTION: ({ args }) => {
    repository.actionCommands.create({
      label: args.label,
      input: args.input,
      actionFn: args.actionFn,
      output: args.output,
      description: args.description,
      category: args.category
    });
  },
  UPDATE_ACTION: ({ args }) => {
    repository.actionCommands.update(args.actionId as EARS.EntityId, {
      label: args.label,
      input: args.input,
      actionFn: args.actionFn,
      output: args.output,
      description: args.description,
      category: args.category
    });
  },
  DELETE_ACTION: ({ args }) => {
    repository.actionCommands.delete(args.actionId as EARS.EntityId);
  },
  IMPORT_ACTIONS: ({ args: { actions: importData } }) => {
    logger.info('Importing actions', { count: Array.isArray(importData) ? importData.length : 0 });

    if (!Array.isArray(importData)) throw new Error('Invalid import data: expected an array of actions');

    const errors: string[] = [];
    let count = 0;

    for (let i = 0; i < importData.length; i++) {
      const item = importData[i];
      if (!item.label || !item.actionFn) {
        errors.push(`Action at index ${i} is missing required fields (label, actionFn)`);
        continue;
      }

      try {
        repository.actionCommands.create({
          label: item.label,
          input: item.input || {},
          actionFn: item.actionFn,
          output: item.output,
          description: item.description,
          category: item.category,
        });
        count++;
      } catch (err) {
        errors.push(`Failed to create action "${item.label}": ${errorMessage(err)}`);
      }
    }

    if (count === 0 && errors.length > 0) throw new Error(errors.join('\n'));

    logger.info('Actions import complete', { count, errors: errors.length });
    return { count, ...(errors.length > 0 ? { errors } : {}) };
  },
  EXPORT_ACTIONS: ({ args: { directory } }) => {
    logger.info('Exporting actions', { directory });
    const exported = exportActions(directory);
    logger.info('Actions export complete', exported);
    return exported;
  },
})

export const actionsSystem = setup({
  types: actionsSpec.types,
  actions: { ...answers.actions, ...actionsSpec.actions({
    handleSettingsUpdate: ({ event }) => {
      const { changes } = actionsSpec.typeOf('FEATURE_SETTINGS_UPDATED', event);
      const categoryChanges = changes?.categories;
      
      if (!categoryChanges) return;
      
      const renames = toMap(categoryChanges.renames);
      // Categories use 'name' property as identifier
      const removed = toIdentifierSet(categoryChanges.removed, (item: any) => item.name);
      
      if (!renames.size && !removed.size) return;
      
      // Fallback to first available category or 'Utility'
      const firstCategoryName = (): string | undefined =>
        featureSettings.forFeature('actions').get()?.categories?.[0]?.name || 'Utility';

      for (const a of repository.actionQueries.all()) {
        const nextCategory = mapScalar(a.category, renames, removed, firstCategoryName);

        if (nextCategory !== a.category) repository.actionCommands.update(a.id, { category: nextCategory });
      }
    },
  }) },
}).createMachine(
  {
    id: 'actions',
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

const actionsEntry = { spec: actionsSpec, machine: actionsSystem };

export default actionsEntry;