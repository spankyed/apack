import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
// import { addMessageToLatestThread, getLatestMessage } from './accessors';
import { EARS } from '#generated/ears.ts';
import { repository } from '#generated/repository.ts';
import type { Contract } from './contract.ts';
import { createLogger } from '@apackdev/sdk/logger';
import { availableModels } from '@apackdev/sdk/models';
import type { ActionEntity, PromptEntity } from '@apackdev/sdk';
import { compileFlowDSL, validateFlowDSL, exportFlowsToDSL, type FlowDSL, type ValidationError } from '@apackdev/sdk/build';


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
 * A window's asks of the flows system, each answered to whoever asked: with what a create, an import or an export made,
 * or that a write landed, or why it was refused. The editor applies its own edits at once and holds the flow's view while any of its writes is
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
  UPDATE_FLOW_LABEL: ({ args }) => { repository.flowsCommands.updateFlowLabel(args.flowId as EARS.EntityId, args.label); },
  DELETE_FLOW: ({ args }) => {
    repository.flowsCommands.deleteFlow(args.flowId as EARS.EntityId);
    logger.info('Deleted a flow', { flowId: args.flowId });
  },
  CREATE_NODE: ({ args }) => {
    const node = repository.flowsCommands.createNode(args.flowId as EARS.EntityId, args.nodeData);
    return { tempId: args.tempId, nodeId: node.id, node };
  },
  UPDATE_NODE: ({ args }) => { repository.flowsCommands.updateNode(args.nodeId as EARS.EntityId, args.nodeData); },
  DELETE_NODE: ({ args }) => { repository.flowsCommands.deleteNode(args.nodeId as EARS.EntityId); },
  CREATE_EDGE: ({ args }) => {
    const { sourceId, targetId, sourceHandle, targetHandle } = args;
    const { relId } = repository.flowsCommands.createEdge(sourceId as EARS.EntityId, targetId as EARS.EntityId, { sourceHandle, targetHandle });
    return { sourceId: sourceId as EARS.EntityId, targetId: targetId as EARS.EntityId, relId, sourceHandle, targetHandle };
  },
  DELETE_EDGE: ({ args }) => { repository.flowsCommands.deleteEdge(args.edgeId as EARS.RelationId); },
  UPDATE_EDGE: ({ args }) => {
    repository.flowsCommands.updateEdge(args.edgeId as EARS.RelationId, {
      source: args.source as EARS.EntityId,
      target: args.target as EARS.EntityId,
      sourceHandle: args.sourceHandle,
      targetHandle: args.targetHandle,
    });
  },
  REINDEX_HANDLES: ({ args }) => { repository.flowsCommands.reindexHandles(args.nodeId as EARS.EntityId, args.prefix, args.index, args.direction); },
  SET_ROOT_FLOW: ({ args }) => {
    const previous = repository.flowsQueries.rootFlow();
    if ((args.flowId ?? undefined) === previous) return;
    logger.info('Changing the root flow', { previousRootFlowId: previous, rootFlowId: args.flowId });
    if (args.flowId) repository.flowsCommands.grantRootFlowRole(args.flowId as EARS.EntityId);
    else if (previous) repository.flowsCommands.revokeRootFlowRole(previous);
  },
  // Refused, naming every reference it could not resolve, unless every one resolves against the actions and prompts
  IMPORT_DSL: ({ args: { dsl } }) => {
    logger.info('Importing DSL flows', { flowCount: Object.keys(dsl || {}).length });

    const actions = repository.actionQueries.all();
    const prompts = repository.promptQueries.all();
    const available = {
      actions: actions.map((a: ActionEntity) => a.label),
      prompts: prompts.map((p: PromptEntity) => p.label),
    };

    const validation = validateFlowDSL(dsl, available);
    if (!validation.valid) {
      const errors = formatValidationErrors(validation.errors, available);
      logger.warn('DSL validation failed', { errors });
      throw new Error(errors.join('\n'));
    }

    const compiled = compileFlowDSL(dsl as FlowDSL, {
      actions: new Map<string, string>(actions.map((a: ActionEntity) => [a.label, a.id])),
      prompts: new Map<string, string>(prompts.map((p: PromptEntity) => [p.label, p.id])),
    });
    const { flowIds } = repository.flowsCommands.importFromDSL(compiled);

    logger.info('DSL import complete', { flowIds });
    return { flowIds };
  },
  EXPORT_DSL: ({ args: { directory, flowId } }) => {
    logger.info('Exporting flows to DSL', { directory, flowId });
    const { filePath, flowCount, skipped } = exportFlowsToDSL(directory, {
      rootFlowRole: EARS.RoleKind.ROOT_FLOW,
      flowIds: flowId ? [flowId] : undefined,
    });
    logger.info('DSL export complete', { filePath, flowCount });
    return { filePath, flowCount, skipped };
  },
});

export const flowsSystem = setup({
  types: flowsSpec.types,
  actors: {},
  actions: { ...answers.actions },
  guards: {},
  delays: {}
}).createMachine({
  id: 'flows',
  initial: 'idle',
  context: {},
  states: {
    idle: {
      on: { ...answers.on },
    },
  }
});

const flowsEntry = { spec: flowsSpec, machine: flowsSystem };

export default flowsEntry;