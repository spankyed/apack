import { query, write } from '#generated/ears.ts';
import { EARS } from '#generated/ears.ts';
import { flowRepository } from '@apackdev/sdk/repositories';
import type {
  NodeEntity,
  FlowExtendedData,
  NodeCreateInput,
  FlowsConnectedData
} from '../types.ts';
import { availableModels } from '@apackdev/sdk/models';
import { repository } from '#generated/repository.ts';
import type { FlowEntity } from '@apackdev/sdk';

/**
 * Flow Repository: the SDK's flow repository (`flowRepository`), which owns the reads and writes of flows, nodes
 * and edges, as the flows surface uses it. Its methods are taken as they are, not wrapped; this adds nodes typed as
 * this pack's step nodes, the connected data the surface shows (the root flow included: the flow with the root role,
 * which is the only record of it), and a flow created with its entry node.
 */

const FLOW_ENTRY_NODE = {
  TYPE: 'listener' as const,
  LABEL: 'Flow Entry',
  COLOR: '#1E88E5',
  SCOPE: 'entry' as const,
  EVENT_TYPE: 'flow.entry',
} as const;

const FLOW_QUERY_FIELDS = {
  LIST: ["id", "label", "flowType", "createdAt"] as const,
} as const;

// Queries
export const flowsQueries = {
  rootFlow: flowRepository.rootFlow,
  getNodeActionId: flowRepository.getNodeActionId,
  flowEdges: flowRepository.flowEdges,

  // The SDK's rows, typed as this pack's step nodes
  node: (nodeId: EARS.EntityId): NodeEntity | undefined => flowRepository.node(nodeId) as NodeEntity | undefined,

  flowNodes: (flowId: EARS.EntityId): NodeEntity[] => flowRepository.flowNodes(flowId) as NodeEntity[],

  extendedData: (
    flowId: EARS.EntityId,
    include?: keyof FlowExtendedData | (keyof FlowExtendedData)[]
  ): FlowExtendedData => {
    const want = (k: keyof FlowExtendedData) =>
      !include
        ? true
        : Array.isArray(include)
          ? include.includes(k)
          : include === k;

    return {
      nodes: want("nodes") ? flowsQueries.flowNodes(flowId) : [],
      edges: want("edges") ? flowsQueries.flowEdges(flowId) : [],
    };
  },

  connectedData: (): FlowsConnectedData => {
    const flows = query(EARS.Entity.Flow)
      .orderBy('createdAt', 'desc')
      .pick(FLOW_QUERY_FIELDS.LIST);

    const rootFlow = query(EARS.Entity.Flow)
      .withRole(EARS.RoleKind.ROOT_FLOW)
      .pickOne(FLOW_QUERY_FIELDS.LIST) ?? undefined;
      
    const flowId = rootFlow?.id ?? 'Flow-1';

    return {
      graph: {
        nodes: flowsQueries.flowNodes(flowId),
        edges: flowsQueries.flowEdges(flowId),
      },
      flows,
      rootFlow,
      selectedFlowId: flowId,
      models: availableModels,
      prompts: repository.promptQueries.all(),
    };
  },
} as const;

// Commands
export const flowsCommands = {
  createFlow: flowRepository.createFlow,
  createEdge: flowRepository.createEdge,
  updateFlowLabel: flowRepository.updateFlowLabel,
  updateNode: flowRepository.updateNode,
  deleteNode: flowRepository.deleteNode,
  deleteEdge: flowRepository.deleteEdge,
  updateEdge: flowRepository.updateEdge,
  grantRootFlowRole: flowRepository.grantRootFlowRole,
  revokeRootFlowRole: flowRepository.revokeRootFlowRole,
  importFromDSL: flowRepository.importFromDSL,
  deleteFlow: flowRepository.deleteFlow,
  reindexHandles: flowRepository.reindexHandles,

  createFlowWithEntryNode: (flow?: Partial<FlowEntity>): { flow: FlowEntity; entryNode: NodeEntity } => {
    const newFlow = flowsCommands.createFlow(flow);
    const entryNode = flowsCommands.createNode(newFlow.id, {
      nodeType: FLOW_ENTRY_NODE.TYPE,
      label: FLOW_ENTRY_NODE.LABEL,
      color: FLOW_ENTRY_NODE.COLOR,
      scope: FLOW_ENTRY_NODE.SCOPE,
      eventType: FLOW_ENTRY_NODE.EVENT_TYPE,
    } as Partial<NodeEntity>);
    write(entryNode.id).grant(EARS.RoleKind.ENTRY_EVENT);
    return { flow: newFlow, entryNode };
  },

  // The SDK's row, typed as this pack's step nodes
  createNode: (flowId: EARS.EntityId, nodeData: NodeCreateInput): NodeEntity =>
    flowRepository.createNode(flowId, nodeData) as NodeEntity,
} as const;
