import { featureSettings } from '#generated/settings.ts';

import { broadcastToSurface } from '#generated/events.ts';
import { setup } from 'xstate';
import type { Reply } from '@apackdev/sdk/events';
import { defineSystem } from '@apackdev/sdk/framework';

import { EARS } from '#generated/ears.ts';
import type { Contract } from './contract.ts';
import type { OutgoingActionEvents } from './types.ts';
import { repository } from '#generated/repository.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { toMap, toIdentifierSet, mapScalar } from '@apackdev/sdk/utils';
import { exportActions } from './repository/export-actions.ts';

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. The
 * actions the import wrote reach every window through its views.
 */
const answer = (reply: Reply<OutgoingActionEvents> | undefined, event: OutgoingActionEvents): void =>
  (reply ? reply(event) : broadcastToSurface('actions', event));
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('actions');

export const actionsSpec = defineSystem<Contract>();

/**
 * The actions system writes actions. What a window shows of them is the feature's views (`views.ts`) — the actions
 * surface's list and open action, and the flows editor's palette — which run again after each of these writes, so
 * nothing here says who is looking.
 */
export const actionsSystem = setup({
  types: actionsSpec.types,
  actions: actionsSpec.actions({
    createAction: ({ event }) => {
      const ev = actionsSpec.typeOf('CREATE_ACTION', event);
      repository.actionCommands.create({
        label: ev.label,
        input: ev.input,
        actionFn: ev.actionFn,
        output: ev.output,
        description: ev.description,
        category: ev.category
      });
    },
    updateAction: ({ event }) => {
      const ev = actionsSpec.typeOf('UPDATE_ACTION', event);
      repository.actionCommands.update(ev.actionId as EARS.EntityId, {
        label: ev.label,
        input: ev.input,
        actionFn: ev.actionFn,
        output: ev.output,
        description: ev.description,
        category: ev.category
      });
    },
    deleteAction: ({ event }) => {
      const ev = actionsSpec.typeOf('DELETE_ACTION', event);
      repository.actionCommands.delete(ev.actionId as EARS.EntityId);
    },
    importActions: ({ event, reply }) => {
      const { actions: importData } = actionsSpec.typeOf('IMPORT_ACTIONS', event);

      logger.info('Importing actions', { count: Array.isArray(importData) ? importData.length : 0 });

      if (!Array.isArray(importData)) {
        answer(reply, {
          type: 'ACTIONS_IMPORT_FAILED',
          errors: ['Invalid import data: expected an array of actions'],
        });
        return;
      }

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
          const message = errorMessage(err);
          errors.push(`Failed to create action "${item.label}": ${message}`);
        }
      }

      if (count === 0 && errors.length > 0) {
        answer(reply, {
          type: 'ACTIONS_IMPORT_FAILED',
          errors,
        });
        return;
      }

      answer(reply, {
        type: 'ACTIONS_IMPORTED',
        count,
        ...(errors.length > 0 ? { errors } : {}),
      });

      logger.info('Actions import complete', { count, errors: errors.length });
    },

    exportActionsToFile: ({ event, reply }) => {
      const { directory } = actionsSpec.typeOf('EXPORT_ACTIONS', event);

      logger.info('Exporting actions', { directory });

      try {
        const { filePath, actionCount } = exportActions(directory);

        answer(reply, {
          type: 'ACTIONS_EXPORTED',
          filePath,
          actionCount,
        });

        logger.info('Actions export complete', { filePath, actionCount });
      } catch (error) {
        const message = errorMessage(error);
        logger.error('Actions export failed', { error: message });

        answer(reply, {
          type: 'ACTIONS_EXPORT_FAILED',
          errors: [message],
        });
      }
    },

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
  }),
}).createMachine(
  {
    id: 'actions',
    initial: 'idle',
    context: () => ({}),
    on: {
      CREATE_ACTION: {
        actions: 'createAction',
      },
      UPDATE_ACTION: {
        actions: 'updateAction',
      },
      DELETE_ACTION: {
        actions: 'deleteAction',
      },
      FEATURE_SETTINGS_UPDATED: {
        actions: 'handleSettingsUpdate',
      },
      IMPORT_ACTIONS: {
        actions: 'importActions',
      },
      EXPORT_ACTIONS: {
        actions: 'exportActionsToFile',
      },
    },
    states: {
      idle: {},
    },
  }
);

const actionsEntry = { spec: actionsSpec, machine: actionsSystem };

export default actionsEntry;