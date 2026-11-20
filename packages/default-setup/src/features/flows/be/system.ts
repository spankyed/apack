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

/** What may fall back to every window: a command's outcome, which someone must hear, and never data a window shows */
type OutcomeType = 'DSL_EXPORT_FAILED' | 'DSL_EXPORTED' | 'DSL_IMPORT_FAILED' | 'DSL_IMPORTED'
type Outcome = Extract<OutgoingFlowsEvents, { type: OutcomeType }>

/**
 * Answers whoever asked for this, and tells every window when nobody did.
 *
 * An import's or an export's *outcome* belongs to the window that started it — another window showing a
 * result for work it did not do, and flipping its own status to success, is what broadcasting it did. The
 * flows the import wrote reach every window through the feature's views.
 */
const answer = (reply: Reply<OutgoingFlowsEvents> | undefined, event: Outcome): void =>
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
 * The flows system writes flows: their nodes and edges, their labels, which one is the root. What a window shows of
 * them is the feature's views (`views.ts`) — the list, and the open flow's graph — which run again after each write,
 * so it sends a window only answers: to its writes, and the model catalog it asks for as it starts.
 */
/**
 * A window's asks of the flows system, each answered to whoever asked: with what a create made, or that a write landed,
 * or why it was refused. The editor applies its own edits at once and holds the flow's view while any of its writes is
 * unanswered, which the table holds whichever way a handler ends — an unanswered one would hold the view for good.
 * What the write changed reaches every window through the \`graph\` view.
 */
export const answers = flowsSpec.answers({
  GET_MODEL_CATALOG: () => ({ models: availableModels }),
  CREATE_FLOW: () => {
    const { flow } = repository.flowsCommands.createFlowWithEntryNode();
    logger.info('Created a flow', { flowId: flow.id });
    // Only the window that asked opens it; every window's list has it through the list view
    return { flowId: flow.id };
  },
  UPDATE_FLOW_LABEL: ({ ask }) => { repository.flowsCommands.updateFlowLabel(ask.flowId as EARS.EntityId, ask.label); },
  DELETE_FLOW: ({ ask }) => {
    repository.flowsCommands.deleteFlow(ask.flowId as EARS.EntityId);
    logger.info('Deleted a flow', { flowId: ask.flowId });
  },
  CREATE_NODE: ({ ask }) => {
    const node = repository.flowsCommands.createNode(ask.flowId as EARS.EntityId, ask.nodeData);
    return { tempId: ask.tempId, nodeId: node.id, node };
  },
  UPDATE_NODE: ({ ask }) => { repository.flowsCommands.updateNode(ask.nodeId as EARS.EntityId, ask.nodeData); },
  DELETE_NODE: ({ ask }) => { repository.flowsCommands.deleteNode(ask.nodeId as EARS.EntityId); },
  CREATE_EDGE: ({ ask }) => {
    const { sourceId, targetId, sourceHandle, targetHandle } = ask;
    const { relId } = repository.flowsCommands.createEdge(sourceId as EARS.EntityId, targetId as EARS.EntityId, { sourceHandle, targetHandle });
    return { sourceId: sourceId as EARS.EntityId, targetId: targetId as EARS.EntityId, relId, sourceHandle, targetHandle };
  },
  DELETE_EDGE: ({ ask }) => { repository.flowsCommands.deleteEdge(ask.edgeId as EARS.RelationId); },
  UPDATE_EDGE: ({ ask }) => {
    repository.flowsCommands.updateEdge(ask.edgeId as EARS.RelationId, {
      source: ask.source as EARS.EntityId,
      target: ask.target as EARS.EntityId,
      sourceHandle: ask.sourceHandle,
      targetHandle: ask.targetHandle,
    });
  },
  REINDEX_HANDLES: ({ ask }) => { repository.flowsCommands.reindexHandles(ask.nodeId as EARS.EntityId, ask.prefix, ask.index, ask.direction); },
  SET_ROOT_FLOW: ({ ask }) => {
    const previous = repository.flowsQueries.rootFlow();
    if ((ask.flowId ?? undefined) === previous) return;
    logger.info('Changing the root flow', { previousRootFlowId: previous, rootFlowId: ask.flowId });
    if (ask.flowId) repository.flowsCommands.grantRootFlowRole(ask.flowId as EARS.EntityId);
    else if (previous) repository.flowsCommands.revokeRootFlowRole(previous);
  },
});

export const flowsSystem = setup({
  types: flowsSpec.types,
  actors: {},
  actions: { ...answers.actions, ...flowsSpec.actions({
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
  }) },
  guards: {},
  delays: {}
}).createMachine({
  id: 'flows',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: {
        ...answers.on,
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