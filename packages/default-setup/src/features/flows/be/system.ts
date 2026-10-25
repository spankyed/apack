import { broadcastToSurface } from '#generated/events.ts';
import { setup } from 'xstate';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingFlowsEvents } from './types.ts';
import { defineSystem } from '@apackdev/sdk/framework';
// import { addMessageToLatestThread, getLatestMessage } from './accessors';
import { EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { Contract } from './contract.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { availableModels } from '@apackdev/sdk/models';
import type { ActionEntity, PromptEntity } from '@apackdev/sdk';
import { compileFlowDSL, validateFlowDSL, exportFlowsToDSL, type FlowDSL, type ValidationError } from '@apackdev/sdk/build';

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. The
 * flows the import wrote reach every window through the feature's views.
 */
const answer = (reply: Reply<OutgoingFlowsEvents> | undefined, event: OutgoingFlowsEvents): void =>
  (reply ? reply(event) : broadcastToSurface('flows', event));
import { errorMessage } from '@apackdev/sdk/utils/pure';

const logger = createLogger('flows');

/**
 * Format validation errors into a cleaner, deduplicated format.
 * Groups missing actions/prompts and shows "Available" list only once.
 */
function formatValidationErrors(
  errors: ValidationError[],
  available: { actions: string[]; prompts: string[] }
): string[] {
  const missingActions = new Set<string>();
  const missingPrompts = new Set<string>();
  const otherErrors: string[] = [];

  for (const error of errors) {
    // Extract missing action/prompt names from error messages
    const actionMatch = error.message.match(/Action "([^"]+)" not found/);
    const promptMatch = error.message.match(/Prompt "([^"]+)" not found/);

    if (actionMatch) {
      missingActions.add(actionMatch[1]);
    } else if (promptMatch) {
      missingPrompts.add(promptMatch[1]);
    } else {
      // Non-reference errors: show path and message
      otherErrors.push(`${error.path}: ${error.message}`);
    }
  }

  const result: string[] = [];

  if (missingActions.size > 0) {
    result.push(`${missingActions.size} action(s) not found: ${Array.from(missingActions).join(', ')}`);
    result.push(`Available actions: ${available.actions.join(', ') || '(none)'}`);
  }

  if (missingPrompts.size > 0) {
    result.push(`${missingPrompts.size} prompt(s) not found: ${Array.from(missingPrompts).join(', ')}`);
    result.push(`Available prompts: ${available.prompts.join(', ') || '(none)'}`);
  }

  result.push(...otherErrors);

  return result;
}

export const flowsSpec = defineSystem<Contract>();

/**
 * One of the graph's writes, answered to whoever asked: with what it made (a node's or an edge's id), or that it
 * landed, or why it was refused. The editor applies its own edits at once and holds the flow's view while any of its
 * writes is unanswered, so every write is answered, a refusal included — an unanswered one would hold the view for
 * good. What the write changed reaches every window through the `graph` view.
 */
function answerWrite(reply: Reply<OutgoingFlowsEvents> | undefined, label: string, write: () => OutgoingFlowsEvents | void): void {
  let answer: OutgoingFlowsEvents;
  try {
    // Run before answering: a write nobody asked for (an applier's, a migration's) has no `reply` and still writes
    answer = write() ?? { type: 'FLOW_WRITTEN' };
  } catch (error) {
    logger.warn(`${label} failed`, { error: errorMessage(error) });
    reply?.({ type: 'FLOW_WRITE_FAILED', error: errorMessage(error) || `${label} failed` });
    return;
  }
  reply?.(answer);
}

/**
 * The flows system writes flows: their nodes and edges, their labels, which one is the root. What a window shows of
 * them is the feature's views (`views.ts`) — the list, and the open flow's graph — which run again after each write,
 * so the only thing it sends unasked is the model catalog, which is the app's rather than a row.
 */
export const flowsSystem = setup({
  types: flowsSpec.types,
  actors: {},
  actions: flowsSpec.actions({
    sendModelCatalog: () => {
      broadcastToSurface('flows', { type: 'FLOWS_CONNECTED', data: { models: availableModels } });
    },

    createFlow: ({ reply }) => {
      answerWrite(reply, 'Creating a flow', () => {
        const { flow } = repository.flowsCommands.createFlowWithEntryNode();
        logger.info('Created a flow', { flowId: flow.id });
        // Only the window that asked opens it; every window's list has it through the list view
        return { type: 'FLOW_OPENED', flowId: flow.id };
      });
    },

    updateFlowLabel: ({ event, reply }) => {
      const { flowId, label } = flowsSpec.typeOf('UPDATE_FLOW_LABEL', event);
      answerWrite(reply, 'Renaming a flow', () => { repository.flowsCommands.updateFlowLabel(flowId as EARS.EntityId, label); });
    },

    deleteFlow: ({ event, reply }) => {
      const { flowId } = flowsSpec.typeOf('DELETE_FLOW', event);
      answerWrite(reply, 'Deleting a flow', () => {
        repository.flowsCommands.deleteFlow(flowId as EARS.EntityId);
        logger.info('Deleted a flow', { flowId });
      });
    },

    createNode: ({ event, reply }) => {
      const { flowId, tempId, nodeData } = flowsSpec.typeOf('CREATE_NODE', event);
      answerWrite(reply, 'Creating a node', () => {
        const node = repository.flowsCommands.createNode(flowId as EARS.EntityId, nodeData);
        return { type: 'NODE_CREATED', tempId, nodeId: node.id, node };
      });
    },

    updateNode: ({ event, reply }) => {
      const { nodeId, nodeData } = flowsSpec.typeOf('UPDATE_NODE', event);
      answerWrite(reply, 'Updating a node', () => { repository.flowsCommands.updateNode(nodeId as EARS.EntityId, nodeData); });
    },

    deleteNode: ({ event, reply }) => {
      const { nodeId } = flowsSpec.typeOf('DELETE_NODE', event);
      answerWrite(reply, 'Deleting a node', () => { repository.flowsCommands.deleteNode(nodeId as EARS.EntityId); });
    },

    createEdge: ({ event, reply }) => {
      const { sourceId, targetId, sourceHandle, targetHandle } = flowsSpec.typeOf('CREATE_EDGE', event);
      answerWrite(reply, 'Connecting two nodes', () => {
        const { relId } = repository.flowsCommands.createEdge(sourceId as EARS.EntityId, targetId as EARS.EntityId, { sourceHandle, targetHandle });
        return { type: 'EDGE_CREATED', sourceId: sourceId as EARS.EntityId, targetId: targetId as EARS.EntityId, relId, sourceHandle, targetHandle };
      });
    },

    deleteEdge: ({ event, reply }) => {
      const { edgeId } = flowsSpec.typeOf('DELETE_EDGE', event);
      answerWrite(reply, 'Disconnecting two nodes', () => { repository.flowsCommands.deleteEdge(edgeId as EARS.RelationId); });
    },

    updateEdge: ({ event, reply }) => {
      const { edgeId, source, target, sourceHandle, targetHandle } = flowsSpec.typeOf('UPDATE_EDGE', event);
      answerWrite(reply, 'Moving an edge', () => {
        repository.flowsCommands.updateEdge(edgeId as EARS.RelationId, {
          source: source as EARS.EntityId,
          target: target as EARS.EntityId,
          sourceHandle,
          targetHandle,
        });
      });
    },

    setRootFlow: ({ event, reply }) => {
      const { flowId } = flowsSpec.typeOf('SET_ROOT_FLOW', event);
      answerWrite(reply, 'Changing the root flow', () => {
        const previous = repository.flowsQueries.rootFlow();
        if ((flowId ?? undefined) === previous) return;
        logger.info('Changing the root flow', { previousRootFlowId: previous, rootFlowId: flowId });
        if (flowId) repository.flowsCommands.grantRootFlowRole(flowId as EARS.EntityId);
        else if (previous) repository.flowsCommands.revokeRootFlowRole(previous);
      });
    },

    importDSL: ({ event, reply }) => {
      const { dsl } = flowsSpec.typeOf('IMPORT_DSL', event);

      logger.info('Importing DSL flows', { flowCount: Object.keys(dsl || {}).length });

      // Get available actions and prompts for reference resolution
      const actions = repository.actionQueries.all();
      const prompts = repository.promptQueries.all();

      // Validate DSL
      const validation = validateFlowDSL(dsl, {
        actions: actions.map((a: ActionEntity) => a.label),
        prompts: prompts.map((p: PromptEntity) => p.label),
      });

      if (!validation.valid) {
        const errors = formatValidationErrors(validation.errors, {
          actions: actions.map((a: ActionEntity) => a.label),
          prompts: prompts.map((p: PromptEntity) => p.label),
        });
        logger.warn('DSL validation failed', { errors });

        answer(reply, {
          type: 'DSL_IMPORT_FAILED',
          errors,
        });
        return;
      }

      // Build lookup maps for compiler
      const actionMap = new Map<string, string>(actions.map((a: ActionEntity) => [a.label, a.id]));
      const promptMap = new Map<string, string>(prompts.map((p: PromptEntity) => [p.label, p.id]));

      // Compile DSL
      const compiled = compileFlowDSL(dsl as FlowDSL, {
        actions: actionMap,
        prompts: promptMap,
      });

      // Import into EARS
      const { flowIds } = repository.flowsCommands.importFromDSL(compiled);

      answer(reply, {
        type: 'DSL_IMPORTED',
        flowIds,
      });

      logger.info('DSL import complete', { flowIds });
    },

    reindexHandles: ({ event, reply }) => {
      const { nodeId, prefix, index, direction } = flowsSpec.typeOf('REINDEX_HANDLES', event);
      answerWrite(reply, 'Renumbering handles', () => { repository.flowsCommands.reindexHandles(nodeId as EARS.EntityId, prefix, index, direction); });
    },

    exportDSL: ({ event, reply }) => {
      const { directory, flowId } = flowsSpec.typeOf('EXPORT_DSL', event);

      logger.info('Exporting flows to DSL', { directory, flowId });

      try {
        const { filePath, flowCount, skipped } = exportFlowsToDSL(directory, {
          rootFlowRole: EARS.RoleKind.ROOT_FLOW,
          flowIds: flowId ? [flowId] : undefined,
        });

        answer(reply, {
          type: 'DSL_EXPORTED',
          filePath,
          flowCount,
          skipped,
        });

        logger.info('DSL export complete', { filePath, flowCount });
      } catch (error) {
        const message = errorMessage(error);
        logger.error('DSL export failed', { error: message });

        answer(reply, {
          type: 'DSL_EXPORT_FAILED',
          errors: [message],
        });
      }
    },
  }),
  guards: {},
  delays: {}
}).createMachine({
  id: 'flows',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: {
        SEND_STATE: {
          actions: 'sendModelCatalog',
        },
        CREATE_FLOW: {
          actions: 'createFlow',
        },
        DELETE_FLOW: {
          actions: 'deleteFlow',
        },
        UPDATE_FLOW_LABEL: {
          actions: 'updateFlowLabel',
        },
        CREATE_NODE: {
          actions: 'createNode',
        },
        UPDATE_NODE: {
          actions: 'updateNode',
        },
        DELETE_NODE: {
          actions: 'deleteNode',
        },
        CREATE_EDGE: {
          actions: 'createEdge',
        },
        DELETE_EDGE: {
          actions: 'deleteEdge',
        },
        UPDATE_EDGE: {
          actions: 'updateEdge',
        },
        REINDEX_HANDLES: {
          actions: 'reindexHandles',
        },
        SET_ROOT_FLOW: {
          actions: 'setRootFlow',
        },
        IMPORT_DSL: {
          actions: 'importDSL',
        },
        EXPORT_DSL: {
          actions: 'exportDSL',
        },
      }
    },
  }
});

const flowsEntry = { spec: flowsSpec, machine: flowsSystem };

export default flowsEntry;