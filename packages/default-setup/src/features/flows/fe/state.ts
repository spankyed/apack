import type { Read, Value } from '@apackdev/state';
import type { OpenEntity } from '@apackdev/sdk/events';
import {
  canGoBack,
  canGoForward,
  createNavHistory,
  entityIs,
  freshKey,
  getStepDeclaration,
  goBack,
  goForward,
  pushNavHistory,
  viewRead,
  viewWrites,
  writeEnded,
  writeSent,
  writing,
  type NavHistory,
  type SurfaceChrome,
  type TrailClickEvent,
  type ViewWrites,
} from '@apackdev/sdk/fe';
import type { EARS } from '@apackdev/sdk';
import { computeMaxBottom, type LayoutNodeData } from '@apackdev/ui/components/node-dimensions';
import { getNodeConfig, isTriggerNode } from '@apackdev/ui/components/node-styles';
import { Edit, Trash2 } from 'lucide-vue-next';
import { state, type PackNet } from '#generated/state.ts';
import type { EdgeEntity, NodeEntity } from '#generated/types.ts';
import type { FlowExtendedData } from '#features/flows/be/types.ts';
import { allNodesHavePositions, calculateLayoutAsync, LAYOUT_CONFIG, layoutComponentAroundSource } from './canvas/layout-utils.ts';
import type { Contract, FlowsContext, FlowsInboxEvent } from './contract.ts';

export const flowsId = 'flows' as const;
export const id = flowsId;

type FlowsAsks = PackNet['systems']['flows']['asks'];

const randId = () => Math.random().toString(36).slice(2, 8);

/** Check if a source handle already has an outgoing edge (single-connection-per-handle rule).
 *  Trigger nodes (listener, schedule) are exempt — they support unlimited parallel exits. */
function isHandleOccupied(
  edges: readonly Read<EdgeEntity>[],
  nodes: readonly any[],
  sourceNodeId: string,
  sourceHandle?: string,
): boolean {
  const sourceNode = nodes.find((n: any) => n.id === sourceNodeId);
  if (isTriggerNode(sourceNode?.nodeType)) return false;

  return edges.some(e => {
    if (e.source !== sourceNodeId) return false;
    if (sourceHandle) return e.sourceHandle === sourceHandle;
    return !e.sourceHandle;
  });
}

/** Scan existing edges from a node and return the next handle index for the given prefix */
function nextHandleIndex(edges: readonly Read<EdgeEntity>[], sourceNodeId: string, prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const indices = edges
    .filter(e => e.source === sourceNodeId && e.sourceHandle)
    .map(e => {
      const match = e.sourceHandle!.match(pattern);
      return match ? parseInt(match[1], 10) : -1;
    })
    .filter(i => i >= 0);
  return indices.length > 0 ? Math.max(...indices) + 1 : 0;
}

/** Shift handle indices on edges when a handle is inserted or removed.
 *  direction=1 (insert): indices >= pivotIndex shift up
 *  direction=-1 (remove): indices > pivotIndex shift down */
function reindexEdges(
  edges: readonly Read<EdgeEntity>[],
  nodeId: string,
  prefix: string,
  pivotIndex: number,
  direction: 1 | -1,
): EdgeEntity[] {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const threshold = direction === 1 ? pivotIndex : pivotIndex + 1;
  return edges.map(edge => {
    if (edge.source !== nodeId || !edge.sourceHandle) return edge as EdgeEntity;
    const m = edge.sourceHandle.match(pattern);
    if (!m) return edge as EdgeEntity;
    const idx = parseInt(m[1], 10);
    if (idx < threshold) return edge as EdgeEntity;
    return { ...(edge as EdgeEntity), sourceHandle: `${prefix}-${idx + direction}` };
  });
}

const HANDLE_OCCUPIED_ERROR = 'This step already has an outbound connection';

/**
 * The fields a new node starts with, onto the node drawn before the backend answers. It reads the same
 * `node` facet the backend's `createNodeDefaults` does, which is what keeps the node on screen and the one
 * that gets stored the same — they read different facets once, and the drawn node carried defaults the
 * stored one did not.
 */
function applyNodeTypeDefaults(nodeData: Record<string, any>): void {
  const defaults = getStepDeclaration(nodeData.nodeType)?.declaration.node.defaults;
  if (defaults) Object.assign(nodeData, structuredClone(defaults));
}

type FlowsInternalEvents =
  | { type: 'INIT_LAYOUT'; controller: LayoutController }
  | {
      type: 'LAYOUT_COMPUTED';
      graph: FlowsContext['graph'];
      positions: Record<string, { x: number; y: number }>;
    };

type UIEvent =
  | FlowsInboxEvent
  | { type: 'NODE.CLICK'; nodeId: string }
  | { type: 'HANDLE.SELECT'; nodeId: string; handleId?: string }
  | { type: 'HANDLE.DESELECT' }
  | { type: 'HANDLE.REINDEX'; nodeId: string; prefix: string; index: number; direction: 1 | -1 }
  | { type: 'NODE.EDITOR.CLOSE' }
  | { type: 'NODE.DELETE'; nodeId: string }
  | { type: 'NODE.SELECTION_CHANGE'; nodeId: string; selected: boolean }
  | { type: 'EDGE.CONNECT'; src: string; tgt: string; sourceHandle?: string; targetHandle?: string }
  | { type: 'EDGE.DISCONNECT'; edgeId: string }
  | { type: 'EDGE.RECONNECT'; edgeId: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }
  | { type: 'NODE.CREATE'; nodeType: string; position?: { x: number; y: number } }
  | { type: 'NODE.CREATE_CONNECTED'; nodeType: string; sourceNodeId: string; sourceHandle?: string }
  | { type: 'NODE.UPDATE'; nodeId: EARS.EntityId; updates: Partial<NodeEntity> }
  | { type: 'NODE.UPDATE_POSITION'; nodeId: string; position: { x: number; y: number } }
  | { type: 'FLOW.PREVIEW'; flowId: EARS.EntityId }
  | { type: 'SELECT_ROOT_FLOW' }
  /** Makes a flow the root flow, or, with null, leaves no flow the root */
  | { type: 'ROOT_FLOW.SET'; flowId: string | null }
  | { type: 'SELECT_AND_EDIT_FIRST_NODE' }
  | { type: 'FLOW.CREATE' }
  | { type: 'FLOW.DELETE'; flowId: EARS.EntityId }
  | { type: 'FLOW.UPDATE_LABEL'; flowId: EARS.EntityId; label: string }
  | { type: 'GO.BACK' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'NAVIGATE_FORWARD' }
  /**
   * What the open flow's graph view read, which the canvas hands on: its nodes and edges, or `null` once the flow is
   * gone. About the UI — whether to show it now or hold it behind the editor's own writes — not the data.
   */
  | { type: 'FLOW.GRAPH_READ'; flowId: EARS.EntityId; data: FlowExtendedData | null }
  /** What the list view read that the breadcrumb and history need: each flow's label, and the root flow */
  | { type: 'FLOWS.READ'; labels: Record<string, string>; rootFlowId?: EARS.EntityId }
  // DSL Import events
  | { type: 'DSL.IMPORT'; dsl: any; flowNames: string[] }
  | { type: 'DSL.RESET_STATUS' }
  // DSL Export events
  | { type: 'DSL.EXPORT'; directory: string; flowId?: string }
  | { type: 'DSL.RESET_EXPORT_STATUS' }
  // Context menu dialog bridge events
  | { type: 'FLOW.REQUEST_EDIT_LABEL' }
  | { type: 'FLOW.REQUEST_DELETE' }
  | { type: 'FLOW.DIALOG_CLOSED' }
  // Canvas error
  | { type: 'CANVAS.CLEAR_ERROR' }
  // Lifecycle events
  | { type: 'SURFACE_DEACTIVATED' }
  | { type: 'SURFACE_STARTED'; ownsAppLayout: boolean };

export type FlowsEvents = OpenEntity | UIEvent | TrailClickEvent;

type FlowsData = Omit<
  FlowsContext,
  'pendingFlow' | 'selectedNodeId' | 'editingNodeId' | 'selectedFlowId' | 'selectedHandle' | 'rootFlowId' | 'showEditLabelDialog' | 'showDeleteFlowDialog' | 'canvasError'
> & {
  pendingFlow: FlowsContext['pendingFlow'];
  selectedNodeId: EARS.EntityId | undefined;
  editingNodeId: EARS.EntityId | undefined;
  selectedFlowId: EARS.EntityId | undefined;
  selectedHandle: FlowsContext['selectedHandle'];
  rootFlowId: EARS.EntityId | undefined;
  showEditLabelDialog: boolean | undefined;
  showDeleteFlowDialog: boolean | undefined;
  canvasError: string | undefined;
  _layout: LayoutController | null;
};

type FlowsShape = {
  data: FlowsData;
  internal: FlowsInternalEvents;
  calls: {
    modelCatalog: 'each';
    createFlow: 'each';
    createNode: { readonly each: FlowsAsks['CREATE_NODE']['args'] };
    createEdge: { readonly each: FlowsAsks['CREATE_EDGE']['args'] };
    importDsl: { readonly each: FlowsAsks['IMPORT_DSL']['args'] };
    exportDsl: { readonly each: FlowsAsks['EXPORT_DSL']['args'] };
    deleteFlow: { readonly each: FlowsAsks['DELETE_FLOW']['args'] };
    updateFlowLabel: { readonly each: FlowsAsks['UPDATE_FLOW_LABEL']['args'] };
    updateNode: { readonly each: FlowsAsks['UPDATE_NODE']['args'] };
    deleteNode: { readonly each: FlowsAsks['DELETE_NODE']['args'] };
    deleteEdge: { readonly each: FlowsAsks['DELETE_EDGE']['args'] };
    updateEdge: { readonly each: FlowsAsks['UPDATE_EDGE']['args'] };
    reindexHandles: { readonly each: FlowsAsks['REINDEX_HANDLES']['args'] };
    setRootFlow: { readonly each: FlowsAsks['SET_ROOT_FLOW']['args'] };
  };
  states: {
    list: {};
    view: {};
  };
};

const LEAVE_VIEW = {
  pendingFlow: undefined,
  selectedNodeId: undefined,
  editingNodeId: undefined,
  selectedHandle: undefined,
} as const;

/** Coordinates async ELK layout runs on the flows surface lifetime so stale or post-stop results are dropped. */
class LayoutController {
  private stopped = false;
  private generation = 0;

  constructor(private readonly send: (event: FlowsInternalEvents) => void) {}

  schedule(
    graph: FlowsContext['graph'],
    data: Pick<FlowsContext['graph'], 'nodes' | 'edges'>,
  ): void {
    if (this.stopped) return;
    const gen = ++this.generation;
    void calculateLayoutAsync(data).then(
      (computed) => {
        if (this.stopped || gen !== this.generation) return;
        this.send({ type: 'LAYOUT_COMPUTED', graph, positions: computed });
      },
      () => {},
    );
  }

  cancel(): void {
    this.generation++;
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
  }
}

/** A layout result belongs to the exact graph that requested it; preserves existing node positions while laying out new nodes. */
function layoutGraph(
  data: Pick<FlowsContext['graph'], 'nodes' | 'edges'>,
  positions: Read<FlowsContext['graph']['positions']>,
  controller: Read<LayoutController> | null,
): FlowsContext['graph'] {
  const keptPositions: Record<string, { x: number; y: number }> = {};
  for (const node of data.nodes) {
    const pos = positions[node.id];
    if (pos) keptPositions[node.id] = { x: pos.x, y: pos.y };
  }
  const needsLayout = data.nodes.length > 0 && !allNodesHavePositions(data.nodes, keptPositions);
  const graph = { ...data, positions: keptPositions };
  if (needsLayout) {
    controller?.schedule(graph, data);
  } else {
    controller?.cancel();
  }
  return graph;
}

function settleWriteData(
  writes: Read<ViewWrites>,
  key: string,
  outcome: { readonly ok: true } | { readonly ok: false; readonly failure: { readonly message: string } },
) {
  return {
    writes: writeEnded(writes as ViewWrites, key, !outcome.ok),
    ...(!outcome.ok ? { canvasError: outcome.failure.message } : {}),
  };
}

function selectFlowData(
  data: Read<FlowsData>,
  flowId: string | undefined,
  options: { nodeId?: string; recordHistory: boolean; navHistory?: NavHistory<string | null> },
): Partial<FlowsData> | undefined {
  if (!flowId) return undefined;
  const nav = (options.navHistory ?? data.navHistory) as NavHistory<string | null>;
  // The flow shown already: its graph is the view's current result, so the node is in it or it isn't
  if (data.selectedFlowId === flowId) {
    const found = !options.nodeId || data.graph.nodes.some(node => node.id === options.nodeId);
    return {
      pendingFlow: undefined,
      ...(options.nodeId && found ? { selectedNodeId: options.nodeId as EARS.EntityId, editingNodeId: options.nodeId as EARS.EntityId, canvasError: undefined } : {}),
      ...(!found ? { canvasError: `Node "${options.nodeId}" is no longer in flow "${flowId}".` } : {}),
      ...(options.recordHistory ? { navHistory: pushNavHistory(nav, flowId) } : options.navHistory ? { navHistory: options.navHistory } : {}),
    };
  }
  // The canvas reads the flow's graph view for it, and the first result opens it
  return {
    pendingFlow: { flowId: flowId as EARS.EntityId, nodeId: options.nodeId, recordHistory: options.recordHistory },
    canvasError: undefined,
    ...(options.navHistory ? { navHistory: options.navHistory } : {}),
  };
}

export const flowsChrome: SurfaceChrome<Value<FlowsShape>> = {
  default: { label: 'Flows', target: 'list' },
  states: {
    list: {
      breadcrumb: { label: 'Flows', target: 'list' },
    },
    view: {
      breadcrumb: ({ data }) => {
        if (!data.selectedFlowId) return { label: '', target: 'view' };
        const label = data.flowLabels[data.selectedFlowId];
        const text = label !== undefined && data.rootFlowId === data.selectedFlowId
          ? `${label || 'Flow'} (Root)`
          : (label || data.selectedFlowId);
        return { label: text, target: 'view' };
      },
      menu: ({ data }) => {
        const isRoot = data.selectedFlowId === data.rootFlowId;
        return [
          { label: 'Edit Label', icon: Edit, event: { type: 'FLOW.REQUEST_EDIT_LABEL' }, iconColor: 'text-primary-400' },
          ...(!isRoot ? [{
            separator: true as const,
            label: 'Delete Flow',
            icon: Trash2,
            event: { type: 'FLOW.REQUEST_DELETE' as const },
            iconColor: 'text-red-400',
          }] : []),
        ];
      },
    },
  },
};

const flowsState = state<FlowsShape, FlowsEvents>()({
  initial: 'list',
  data: {
    pendingFlow: undefined,
    selectedNodeId: undefined,
    editingNodeId: undefined,
    selectedFlowId: undefined,
    selectedHandle: undefined,
    rootFlowId: undefined,
    showEditLabelDialog: undefined,
    showDeleteFlowDialog: undefined,
    canvasError: undefined,
    graph: {
      nodes: [],
      edges: [],
      positions: {},
    },
    models: [],
    writes: viewWrites(),
    flowLabels: {},
    tempIdMap: {},
    dslImport: {
      status: 'idle',
      errors: [],
      importedFlowNames: [],
    },
    dslExport: {
      status: 'idle',
      errors: [],
      filePath: '',
      flowCount: 0,
      skipped: [],
    },
    navHistory: createNavHistory<string | null>(null),
    _layout: null,
  },
  listen: ({ send }) => {
    const controller = new LayoutController((event) => send(event));
    send({ type: 'INIT_LAYOUT', controller });
    return () => controller.stop();
  },
  calls: ({ each }) => ({
    modelCatalog: each('flows', 'GET_MODEL_CATALOG', {
      done: (outcome) => (outcome.ok ? { data: { models: outcome.value.models } } : { data: { canvasError: outcome.failure.message } }),
    }),
    createFlow: each('flows', 'CREATE_FLOW', {
      // The flow this window asked to create, which only the window that asked is answered with — so only it navigates
      done: (outcome, { key, data }) => {
        if (!outcome.ok) return { data: settleWriteData(data.writes, key, outcome) };
        return {
          at: 'view',
          data: {
            pendingFlow: { flowId: outcome.value.flowId, recordHistory: true },
            selectedNodeId: undefined,
            editingNodeId: undefined,
          },
        };
      },
    }),
    createNode: each('flows', 'CREATE_NODE', {
      args: (_key, input) => input,
      done: (outcome, { key, data, call }) => {
        if (!outcome.ok) return { data: settleWriteData(data.writes, key, outcome) };
        const { tempId, nodeId: permanentId, node } = outcome.value;

        // The node from backend already has the permanent ID, just replace the temp node. A refresh may already
        // have brought the permanent node, and then the temp one is only dropped
        const arrived = data.graph.nodes.some(n => n.id === permanentId);
        const updatedNodes = arrived
          ? data.graph.nodes.filter(n => n.id !== tempId)
          : data.graph.nodes.map(n => (n.id === tempId ? node : n));

        const newSelectedNodeId = data.selectedNodeId === tempId ? permanentId : data.selectedNodeId;
        const newEditingNodeId = data.editingNodeId === tempId ? permanentId : data.editingNodeId;

        const updatedEdges = data.graph.edges.map(edge => ({
          ...(edge as EdgeEntity),
          source: (edge.source === tempId ? permanentId : edge.source) as EARS.EntityId,
          target: (edge.target === tempId ? permanentId : edge.target) as EARS.EntityId,
        }));

        const updatedPositions = { ...data.graph.positions } as Record<string, { x: number; y: number }>;
        if (updatedPositions[tempId]) {
          updatedPositions[permanentId] = updatedPositions[tempId];
          delete updatedPositions[tempId];
        }

        const updatedTempIdMap = { ...data.tempIdMap, [tempId]: permanentId };

        // Ask the backend for any edges with the new permanent ID
        let writes = data.writes as ViewWrites;
        if (data.selectedFlowId) {
          updatedEdges.forEach(edge => {
            const prevEdge = data.graph.edges.find(e => e.id === edge.id);
            const wasUpdated = (edge.source === permanentId && prevEdge?.source === tempId)
              || (edge.target === permanentId && prevEdge?.target === tempId);

            if (wasUpdated && !edge.source.startsWith('temp-') && !edge.target.startsWith('temp-')) {
              const edgeWrite = freshKey();
              call('createEdge', edgeWrite, {
                flowId: data.selectedFlowId!,
                sourceId: edge.source,
                targetId: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
              });
              writes = writeSent(writes, edgeWrite);
            }
          });
        }

        writes = writeEnded(writes, key, false);
        return {
          data: {
            graph: {
              nodes: updatedNodes as NodeEntity[],
              edges: updatedEdges,
              positions: updatedPositions,
            },
            selectedNodeId: newSelectedNodeId,
            editingNodeId: newEditingNodeId,
            tempIdMap: updatedTempIdMap,
            writes,
          },
        };
      },
    }),
    createEdge: each('flows', 'CREATE_EDGE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => {
        if (!outcome.ok) return { data: settleWriteData(data.writes, key, outcome) };
        const { sourceId, targetId, relId, sourceHandle, targetHandle } = outcome.value;

        const updatedEdges = data.graph.edges.map(edge => {
          const sourceMatches = edge.source === sourceId;
          const targetMatches = edge.target === targetId;
          const sourceHandleMatches = (sourceHandle || null) === (edge.sourceHandle || null);
          const targetHandleMatches = (targetHandle || null) === (edge.targetHandle || null);

          if (sourceMatches && targetMatches && sourceHandleMatches && targetHandleMatches) {
            return { ...(edge as EdgeEntity), id: relId as EARS.EntityId };
          }
          return edge as EdgeEntity;
        });

        return {
          data: {
            graph: {
              nodes: data.graph.nodes as NodeEntity[],
              edges: updatedEdges,
              positions: data.graph.positions,
            },
            writes: writeEnded(data.writes as ViewWrites, key, false),
          },
        };
      },
    }),
    deleteFlow: each('flows', 'DELETE_FLOW', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    updateFlowLabel: each('flows', 'UPDATE_FLOW_LABEL', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    updateNode: each('flows', 'UPDATE_NODE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    deleteNode: each('flows', 'DELETE_NODE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    deleteEdge: each('flows', 'DELETE_EDGE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    updateEdge: each('flows', 'UPDATE_EDGE', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    reindexHandles: each('flows', 'REINDEX_HANDLES', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    setRootFlow: each('flows', 'SET_ROOT_FLOW', {
      args: (_key, input) => input,
      done: (outcome, { key, data }) => ({ data: settleWriteData(data.writes, key, outcome) }),
    }),
    importDsl: each('flows', 'IMPORT_DSL', {
      args: (_key, input) => input,
      done: (outcome, { data }) => ({
        data: {
          dslImport: outcome.ok
            // The names are the ones read from the file as it was sent
            ? { status: 'success' as const, errors: [], importedFlowNames: [...data.dslImport.importedFlowNames] }
            : { status: 'error' as const, errors: outcome.failure.message.split('\n'), importedFlowNames: [] },
        },
      }),
    }),
    exportDsl: each('flows', 'EXPORT_DSL', {
      args: (_key, input) => input,
      done: (outcome) => ({
        data: {
          dslExport: outcome.ok
            ? { status: 'success' as const, errors: [], ...outcome.value }
            : { status: 'error' as const, errors: [outcome.failure.message], filePath: '', flowCount: 0, skipped: [] },
        },
      }),
    }),
  }),
  internal: {
    INIT_LAYOUT: ({ controller }) => ({ data: { _layout: controller } }),
    LAYOUT_COMPUTED: (event, { data }) => {
      // Node ids are unique to a flow, so a shared node means the same flow, however often its graph was rebuilt
      // since the layout was asked for; another flow's late layout shares none and is dropped
      if (!event.graph.nodes.some(node => data.graph.nodes.some(current => current.id === node.id))) return;
      const computed = Object.fromEntries(
        data.graph.nodes.flatMap(node => (event.positions[node.id] ? [[node.id, event.positions[node.id]]] : [])),
      );
      return {
        data: {
          graph: {
            nodes: data.graph.nodes as NodeEntity[],
            edges: data.graph.edges as EdgeEntity[],
            positions: { ...computed, ...data.graph.positions },
          },
        },
      };
    },
  },
  on: {
    OPEN_ENTITY: (event, { data }) => {
      if (!entityIs<Contract['opens']>({ event }, { entity: 'Flow' })) return;
      const updates = selectFlowData(data, event.id, { recordHistory: true });
      return updates ? { at: 'view', data: updates } : { at: 'view' };
    },
    'FLOW.SELECT': (event, { data }) => {
      const updates = selectFlowData(data, event.flowId, { recordHistory: true });
      return updates ? { at: 'view', data: updates } : { at: 'view' };
    },
    'NODE.REVEAL': (event, { data }) => {
      const updates = selectFlowData(data, event.flowId, { nodeId: event.nodeId, recordHistory: true });
      return updates ? { at: 'view', data: updates } : { at: 'view' };
    },
    SURFACE_DEACTIVATED: () => ({ data: { pendingFlow: undefined } }),
    // The models the editor offers, asked as the shell starts the surface
    SURFACE_STARTED: (_event, { call }) => {
      call('modelCatalog', freshKey());
    },
    'FLOWS.READ': (event) => ({ data: { flowLabels: event.labels, rootFlowId: event.rootFlowId } }),
    'ROOT_FLOW.SET': (event, { call }) => {
      call('setRootFlow', freshKey(), { flowId: event.flowId });
    },
    'FLOW.GRAPH_READ': (event, { data }) => {
      const readsPendingFlow = data.pendingFlow?.flowId === event.flowId;
      const readsShownFlow = !data.pendingFlow && data.selectedFlowId === event.flowId;

      if (readsPendingFlow && event.data === null) {
        return {
          data: {
            pendingFlow: undefined,
            canvasError: `Flow "${event.flowId}" was deleted before it could be opened.`,
          },
        };
      }
      if (readsPendingFlow && event.data !== null) {
        const request = data.pendingFlow;
        const nodeId = request?.nodeId;
        const found = nodeId && event.data.nodes.some(node => node.id === nodeId);
        return {
          data: {
            pendingFlow: undefined,
            selectedFlowId: event.flowId,
            selectedNodeId: found ? (nodeId as EARS.EntityId) : undefined,
            editingNodeId: found ? (nodeId as EARS.EntityId) : undefined,
            selectedHandle: undefined,
            canvasError: nodeId && !found ? `Node "${nodeId}" is no longer in flow "${event.flowId}".` : undefined,
            graph: layoutGraph(event.data, data.selectedFlowId === event.flowId ? data.graph.positions : {}, data._layout),
            navHistory: request?.recordHistory ? pushNavHistory(data.navHistory as NavHistory<string | null>, event.flowId) : data.navHistory,
            writes: viewRead(data.writes as ViewWrites).writes,
          },
        };
      }
      if (readsShownFlow && event.data === null) {
        data._layout?.cancel();
        return {
          at: 'list',
          data: {
            ...LEAVE_VIEW,
            selectedFlowId: undefined,
            graph: { nodes: [], edges: [], positions: {} },
            writes: viewWrites(),
          },
        };
      }
      if (readsShownFlow && writing(data.writes as ViewWrites)) {
        return { data: { writes: viewRead(data.writes as ViewWrites).writes } };
      }
      if (readsShownFlow && event.data !== null) {
        const graphData = event.data;
        const kept = (node: EARS.EntityId | undefined) => (node && graphData.nodes.some(each => each.id === node) ? node : undefined);
        return {
          data: {
            selectedNodeId: kept(data.selectedNodeId),
            editingNodeId: kept(data.editingNodeId),
            graph: layoutGraph(graphData, data.graph.positions, data._layout),
            writes: viewRead(data.writes as ViewWrites).writes,
          },
        };
      }
    },
    'CANVAS.CLEAR_ERROR': () => ({ data: { canvasError: undefined } }),
    // DSL Import events
    'DSL.IMPORT': (event, { data, call }) => {
      call('importDsl', freshKey(), { dsl: event.dsl });
      return {
        data: {
          dslImport: {
            ...data.dslImport,
            importedFlowNames: event.flowNames,
            status: 'importing' as const,
          },
        },
      };
    },
    'DSL.RESET_STATUS': () => ({
      data: {
        dslImport: { status: 'idle' as const, errors: [], importedFlowNames: [] },
      },
    }),
    // DSL Export events
    'DSL.EXPORT': (event, { data, call }) => {
      call('exportDsl', freshKey(), { directory: event.directory, ...(event.flowId ? { flowId: event.flowId } : {}) });
      return {
        data: {
          dslExport: {
            ...data.dslExport,
            status: 'exporting' as const,
          },
        },
      };
    },
    'DSL.RESET_EXPORT_STATUS': () => ({
      data: {
        dslExport: { status: 'idle' as const, errors: [], filePath: '', flowCount: 0, skipped: [] },
      },
    }),
    NAVIGATE_BACK: (_event, { data }) => {
      const nav = data.navHistory as NavHistory<string | null>;
      if (!canGoBack(nav)) return;
      const target = nav.stack[nav.index - 1];
      if (target === null) {
        const result = goBack(nav)!;
        return { at: 'list', data: { ...LEAVE_VIEW, navHistory: result.history, selectedFlowId: undefined } };
      }
      if (target in data.flowLabels) {
        const result = goBack(nav)!;
        const updates = selectFlowData(data, target, { recordHistory: false, navHistory: result.history });
        return updates ? { at: 'view', data: updates } : { at: 'view', data: { navHistory: result.history } };
      }
    },
    NAVIGATE_FORWARD: (_event, { data }) => {
      const nav = data.navHistory as NavHistory<string | null>;
      if (!canGoForward(nav)) return;
      const target = nav.stack[nav.index + 1];
      if (target === null) {
        const result = goForward(nav)!;
        return { at: 'list', data: { ...LEAVE_VIEW, navHistory: result.history, selectedFlowId: undefined } };
      }
      if (target in data.flowLabels) {
        const result = goForward(nav)!;
        const updates = selectFlowData(data, target, { recordHistory: false, navHistory: result.history });
        return updates ? { at: 'view', data: updates } : { at: 'view', data: { navHistory: result.history } };
      }
    },
    TRAIL_CLICK: (event, { data }) => {
      if (event.target === 'list') {
        return {
          at: 'list',
          data: {
            ...LEAVE_VIEW,
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, null),
          },
        };
      }
      if (event.target === 'view') {
        return { at: 'view' };
      }
    },
  },
  states: {
    list: {
      on: {
        'FLOW.PREVIEW': (event, { data }) => {
          const updates = selectFlowData(data, event.flowId, { recordHistory: false });
          return updates ? { data: updates } : undefined;
        },
        SELECT_ROOT_FLOW: (_event, { data }) => {
          const updates = selectFlowData(data, data.rootFlowId, { recordHistory: true });
          return updates ? { at: 'view', data: updates } : { at: 'view' };
        },
        'FLOW.CREATE': (_event, { call }) => {
          call('createFlow', freshKey());
        },
        'FLOW.DELETE': (event, { call }) => {
          call('deleteFlow', freshKey(), { flowId: event.flowId });
        },
        'FLOW.UPDATE_LABEL': (event, { call }) => {
          call('updateFlowLabel', freshKey(), { flowId: event.flowId, label: event.label });
        },
      },
    },
    view: {
      on: {
        'FLOW.SELECT': (event, { data }) => {
          const updates = selectFlowData(data, event.flowId, { recordHistory: true });
          return updates ? { data: updates } : undefined;
        },
        SELECT_ROOT_FLOW: (_event, { data }) => {
          const updates = selectFlowData(data, data.rootFlowId, { recordHistory: true });
          return updates ? { data: updates } : undefined;
        },
        SELECT_AND_EDIT_FIRST_NODE: (_event, { data }) => {
          const firstNode = data.graph.nodes[0];
          if (!firstNode) {
            console.warn('No nodes available to edit');
            return;
          }
          return {
            data: {
              selectedNodeId: firstNode.id as EARS.EntityId,
              editingNodeId: firstNode.id as EARS.EntityId,
            },
          };
        },
        'NODE.CLICK': (event, { data, call }) => {
          const handle = data.selectedHandle;
          if (!handle) return { data: { selectedNodeId: event.nodeId as EARS.EntityId } };

          // Don't connect to self — select the node and clear handle instead
          if (handle.nodeId === event.nodeId) {
            return { data: { selectedNodeId: event.nodeId as EARS.EntityId, selectedHandle: undefined } };
          }

          // Don't create duplicate edge to an already-connected target
          const alreadyConnected = data.graph.edges.some(
            e => e.source === handle.nodeId && e.target === event.nodeId,
          );
          if (alreadyConnected) {
            return { data: { selectedNodeId: event.nodeId as EARS.EntityId, selectedHandle: undefined } };
          }

          // Don't connect to trigger nodes (no inputs)
          const clickedNode = data.graph.nodes.find(n => n.id === event.nodeId);
          if (isTriggerNode(clickedNode?.nodeType)) {
            return { data: { selectedNodeId: event.nodeId as EARS.EntityId, selectedHandle: undefined } };
          }

          // Don't connect if source handle already has an outgoing edge (except listeners)
          if (isHandleOccupied(data.graph.edges, data.graph.nodes, handle.nodeId, handle.handleId)) {
            return {
              data: {
                selectedNodeId: event.nodeId as EARS.EntityId,
                selectedHandle: undefined,
                canvasError: HANDLE_OCCUPIED_ERROR,
              },
            };
          }

          const edgeId = `Edge-${randId()}`;
          const newEdge = {
            id: edgeId,
            source: handle.nodeId,
            target: event.nodeId,
            kind: 'transitions_to',
            sourceHandle: handle.handleId,
          } as EdgeEntity;

          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId && !handle.nodeId.startsWith('temp-') && !event.nodeId.startsWith('temp-')) {
            const write = freshKey();
            call('createEdge', write, {
              flowId: data.selectedFlowId,
              sourceId: handle.nodeId,
              targetId: event.nodeId,
              sourceHandle: handle.handleId,
            });
            writes = writeSent(writes, write);
          }

          return {
            data: {
              writes,
              graph: {
                nodes: data.graph.nodes as NodeEntity[],
                edges: [...(data.graph.edges as EdgeEntity[]), newEdge],
                positions: data.graph.positions,
              },
              selectedHandle: undefined,
            },
          };
        },
        'NODE.SELECTION_CHANGE': (event) => ({
          data: { selectedNodeId: event.selected && event.nodeId ? (event.nodeId as EARS.EntityId) : undefined },
        }),
        'NODE.DOUBLE_CLICK': (event) => ({
          data: { pendingFlow: undefined, editingNodeId: event.nodeId as EARS.EntityId },
        }),
        'NODE.EDITOR.CLOSE': () => ({ data: { editingNodeId: undefined } }),
        'HANDLE.SELECT': (event) => ({
          data: { selectedHandle: { nodeId: event.nodeId, handleId: event.handleId } },
        }),
        'HANDLE.DESELECT': () => ({ data: { selectedHandle: undefined } }),
        'HANDLE.REINDEX': (event, { data, call }) => {
          const updatedEdges = reindexEdges(data.graph.edges, event.nodeId, event.prefix, event.index, event.direction);
          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId) {
            const nodeId = event.nodeId.startsWith('temp-')
              ? data.tempIdMap[event.nodeId] || event.nodeId
              : event.nodeId;
            if (!nodeId.startsWith('temp-')) {
              const write = freshKey();
              call('reindexHandles', write, {
                flowId: data.selectedFlowId,
                nodeId,
                prefix: event.prefix,
                index: event.index,
                direction: event.direction,
              });
              writes = writeSent(writes, write);
            }
          }
          return {
            data: {
              writes,
              graph: {
                nodes: data.graph.nodes as NodeEntity[],
                edges: updatedEdges,
                positions: data.graph.positions,
              },
            },
          };
        },
        'NODE.DELETE': (event, { data, call }) => {
          const nodeId = event.nodeId;
          const updatedNodes = data.graph.nodes.filter(n => n.id !== nodeId);
          const updatedEdges = data.graph.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId);
          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId) {
            const write = freshKey();
            call('deleteNode', write, { flowId: data.selectedFlowId, nodeId });
            writes = writeSent(writes, write);
          }
          return {
            data: {
              writes,
              graph: {
                nodes: updatedNodes as NodeEntity[],
                edges: updatedEdges as EdgeEntity[],
                positions: data.graph.positions,
              },
              selectedNodeId: data.selectedNodeId === nodeId ? undefined : data.selectedNodeId,
              editingNodeId: data.editingNodeId === nodeId ? undefined : data.editingNodeId,
            },
          };
        },
        'EDGE.CONNECT': (event, { data, call }) => {
          if (event.src === event.tgt) return;
          const alreadyConnected = data.graph.edges.some(e => e.source === event.src && e.target === event.tgt);
          if (alreadyConnected) return;
          const targetNode = data.graph.nodes.find(n => n.id === event.tgt);
          if (isTriggerNode(targetNode?.nodeType)) return;
          if (isHandleOccupied(data.graph.edges, data.graph.nodes, event.src, event.sourceHandle)) {
            return { data: { canvasError: HANDLE_OCCUPIED_ERROR } };
          }

          const newEdge = {
            id: `Edge-${randId()}`,
            source: event.src,
            target: event.tgt,
            kind: 'transitions_to',
            sourceHandle: event.sourceHandle,
            targetHandle: event.targetHandle,
          } as EdgeEntity;

          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId && !event.src.startsWith('temp-') && !event.tgt.startsWith('temp-')) {
            const write = freshKey();
            call('createEdge', write, {
              flowId: data.selectedFlowId,
              sourceId: event.src,
              targetId: event.tgt,
              sourceHandle: event.sourceHandle,
              targetHandle: event.targetHandle,
            });
            writes = writeSent(writes, write);
          }

          return {
            data: {
              writes,
              graph: {
                nodes: data.graph.nodes as NodeEntity[],
                edges: [...(data.graph.edges as EdgeEntity[]), newEdge],
                positions: data.graph.positions,
              },
            },
          };
        },
        'EDGE.DISCONNECT': (event, { data, call }) => {
          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId) {
            const write = freshKey();
            call('deleteEdge', write, { flowId: data.selectedFlowId, edgeId: event.edgeId });
            writes = writeSent(writes, write);
          }
          return {
            data: {
              writes,
              graph: {
                nodes: data.graph.nodes as NodeEntity[],
                edges: data.graph.edges.filter(edge => edge.id !== event.edgeId) as EdgeEntity[],
                positions: data.graph.positions,
              },
            },
          };
        },
        'EDGE.RECONNECT': (event, { data, call }) => {
          const edges = data.graph.edges.map(edge =>
            edge.id === event.edgeId
              ? {
                  ...(edge as EdgeEntity),
                  source: event.source as EARS.EntityId,
                  target: event.target as EARS.EntityId,
                  sourceHandle: event.sourceHandle,
                  targetHandle: event.targetHandle,
                }
              : (edge as EdgeEntity),
          );
          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId) {
            const write = freshKey();
            call('updateEdge', write, {
              flowId: data.selectedFlowId,
              edgeId: event.edgeId,
              source: event.source,
              target: event.target,
              sourceHandle: event.sourceHandle,
              targetHandle: event.targetHandle,
            });
            writes = writeSent(writes, write);
          }
          return {
            data: {
              writes,
              graph: {
                nodes: data.graph.nodes as NodeEntity[],
                edges,
                positions: data.graph.positions,
              },
            },
          };
        },
        'NODE.CREATE': (event, { data, call, send }) => {
          if (!data.selectedFlowId) return { data: { selectedNodeId: undefined } };

          const tempId = `temp-${randId()}`;
          const nodeConfig = getNodeConfig(event.nodeType);
          const label = nodeConfig?.defaultLabel || nodeConfig?.label || `New ${event.nodeType}`;

          const write = freshKey();
          call('createNode', write, {
            flowId: data.selectedFlowId,
            tempId,
            nodeData: { nodeType: event.nodeType, label },
          });
          const writes = writeSent(data.writes as ViewWrites, write);

          const { newNode: nodeOffset } = LAYOUT_CONFIG;
          const positions = data.graph.positions;
          const allPos = Object.values(positions);
          const isListener = nodeConfig?.connectionRules.inputs === 0;

          const maxBottom = allPos.length > 0
            ? computeMaxBottom(data.graph.nodes as LayoutNodeData[], positions as Record<string, { x: number; y: number }>, data.graph.edges as EdgeEntity[])
            : 0;

          const existingListenerX = data.graph.nodes.find(n => isTriggerNode(n.nodeType) && positions[n.id]);
          const alignX = existingListenerX ? positions[existingListenerX.id].x : 0;

          const belowAllPos = maxBottom > 0
            ? { x: alignX, y: maxBottom + LAYOUT_CONFIG.chainGap }
            : { x: nodeOffset.defaultX, y: nodeOffset.defaultY };

          let newPosition: { x: number; y: number };
          let autoEdge: EdgeEntity | null = null;
          let handleBlocked = false;

          if (event.position) {
            newPosition = event.position;
          } else if (isListener) {
            newPosition = belowAllPos;
          } else if (data.selectedNodeId && positions[data.selectedNodeId]) {
            const selectedPos = positions[data.selectedNodeId];
            newPosition = { x: selectedPos.x + nodeOffset.xOffset, y: selectedPos.y + nodeOffset.yOffset };

            const selectedNode = data.graph.nodes.find(n => n.id === data.selectedNodeId);
            const selectedConfig = selectedNode ? getNodeConfig(selectedNode.nodeType) : null;
            if (selectedConfig?.connectionRules.outputs !== 0) {
              let sourceHandle: string | undefined;
              if (selectedConfig?.connectionRules.inputs === 0) {
                const existingExits = data.graph.edges
                  .filter(e => e.source === data.selectedNodeId && e.sourceHandle)
                  .map(e => {
                    const match = e.sourceHandle!.match(/exit-(\d+)/);
                    return match ? parseInt(match[1], 10) : -1;
                  });
                const nextIndex = existingExits.length > 0 ? Math.max(...existingExits) + 1 : 0;
                sourceHandle = `exit-${nextIndex}`;
              } else if (selectedNode?.nodeType) {
                const prefix = getStepDeclaration(selectedNode.nodeType)?.declaration.fe?.handlePrefix;
                if (prefix) {
                  sourceHandle = `${prefix}-${nextHandleIndex(data.graph.edges, data.selectedNodeId, prefix)}`;
                }
              }

              if (!isHandleOccupied(data.graph.edges, data.graph.nodes, data.selectedNodeId, sourceHandle)) {
                autoEdge = {
                  id: `Edge-${randId()}`,
                  source: data.selectedNodeId,
                  target: tempId,
                  kind: 'transitions_to',
                  ...(sourceHandle ? { sourceHandle } : {}),
                } as EdgeEntity;
              } else {
                handleBlocked = true;
                newPosition = belowAllPos;
              }
            }
          } else {
            newPosition = belowAllPos;
          }

          const tempNodeData: any = { id: tempId, nodeType: event.nodeType, label, flowId: data.selectedFlowId, configuration: {} };
          applyNodeTypeDefaults(tempNodeData);

          if (autoEdge && data.selectedNodeId) {
            layoutComponentAroundSource(
              data.selectedNodeId,
              [...(data.graph.nodes as NodeEntity[]), tempNodeData],
              [...(data.graph.edges as EdgeEntity[]), autoEdge],
              positions as Record<string, { x: number; y: number }>,
              (nodeId, position) => send({ type: 'NODE.UPDATE_POSITION', nodeId, position }),
            );
          }

          return {
            data: {
              writes,
              graph: {
                nodes: [...(data.graph.nodes as NodeEntity[]), tempNodeData],
                edges: autoEdge ? [...(data.graph.edges as EdgeEntity[]), autoEdge] : (data.graph.edges as EdgeEntity[]),
                positions: { ...positions, [tempId]: newPosition },
              },
              selectedNodeId: tempId as EARS.EntityId,
              tempIdMap: { ...data.tempIdMap, [tempId]: tempId },
              canvasError: handleBlocked ? HANDLE_OCCUPIED_ERROR : undefined,
            },
          };
        },
        'NODE.CREATE_CONNECTED': (event, { data, call, send }) => {
          if (!data.selectedFlowId) return { data: { selectedNodeId: undefined } };

          const tempId = `temp-${randId()}`;
          const nodeConfig = getNodeConfig(event.nodeType);
          const defaultLabel = nodeConfig?.defaultLabel || nodeConfig?.label || `New ${event.nodeType}`;

          const newNode: any = {
            id: tempId,
            nodeType: event.nodeType,
            label: defaultLabel,
            flowId: data.selectedFlowId,
            configuration: {},
          };
          applyNodeTypeDefaults(newNode);

          const { newNode: nodeOffset } = LAYOUT_CONFIG;
          const positions = data.graph.positions;
          const sourcePos = positions[event.sourceNodeId];
          const newPosition = sourcePos
            ? { x: sourcePos.x + nodeOffset.xOffset, y: sourcePos.y + nodeOffset.yOffset }
            : { x: nodeOffset.fallbackX, y: nodeOffset.fallbackY };

          let resolvedSourceHandle = event.sourceHandle;
          if (!resolvedSourceHandle) {
            const sourceNode = data.graph.nodes.find(n => n.id === event.sourceNodeId);
            const handlePrefix = sourceNode?.nodeType ? getStepDeclaration(sourceNode.nodeType)?.declaration.fe?.handlePrefix : undefined;
            if (handlePrefix) {
              resolvedSourceHandle = `${handlePrefix}-${nextHandleIndex(data.graph.edges, event.sourceNodeId, handlePrefix)}`;
            } else if (isTriggerNode(sourceNode?.nodeType)) {
              const existingExits = data.graph.edges
                .filter(e => e.source === event.sourceNodeId && e.sourceHandle)
                .map(e => {
                  const match = e.sourceHandle!.match(/exit-(\d+)/);
                  return match ? parseInt(match[1], 10) : -1;
                });
              const nextIndex = existingExits.length > 0 ? Math.max(...existingExits) + 1 : 0;
              resolvedSourceHandle = `exit-${nextIndex}`;
            }
          }

          if (isHandleOccupied(data.graph.edges, data.graph.nodes, event.sourceNodeId, resolvedSourceHandle)) {
            return { data: { canvasError: HANDLE_OCCUPIED_ERROR } };
          }

          const tempEdge: EdgeEntity = {
            id: `Edge-${randId()}`,
            source: event.sourceNodeId,
            target: tempId,
            kind: 'transitions_to',
            sourceHandle: resolvedSourceHandle,
          } as EdgeEntity;

          const write = freshKey();
          call('createNode', write, {
            flowId: data.selectedFlowId,
            tempId,
            nodeData: { nodeType: event.nodeType, label: newNode.label },
          });
          const writes = writeSent(data.writes as ViewWrites, write);

          layoutComponentAroundSource(
            event.sourceNodeId,
            [...(data.graph.nodes as NodeEntity[]), newNode],
            [...(data.graph.edges as EdgeEntity[]), tempEdge],
            positions as Record<string, { x: number; y: number }>,
            (nodeId, position) => send({ type: 'NODE.UPDATE_POSITION', nodeId, position }),
          );

          return {
            data: {
              writes,
              graph: {
                nodes: [...(data.graph.nodes as NodeEntity[]), newNode],
                edges: [...(data.graph.edges as EdgeEntity[]), tempEdge],
                positions: { ...positions, [tempId]: newPosition },
              },
              selectedNodeId: tempId as EARS.EntityId,
              editingNodeId: tempId as EARS.EntityId,
              tempIdMap: { ...data.tempIdMap, [tempId]: tempId },
            },
          };
        },
        'NODE.UPDATE': (event, { data, call }) => {
          const updatedNodes = data.graph.nodes.map(node =>
            node.id === event.nodeId ? { ...(node as NodeEntity), ...event.updates } : (node as NodeEntity),
          ) as NodeEntity[];

          let writes = data.writes as ViewWrites;
          if (data.selectedFlowId) {
            const nodeId = event.nodeId.startsWith('temp-')
              ? data.tempIdMap[event.nodeId] || event.nodeId
              : event.nodeId;
            if (nodeId.startsWith('temp-')) {
              console.warn('Cannot update node with temporary ID:', nodeId);
            } else {
              const node = updatedNodes.find(n => n.id === nodeId);
              if (node) {
                const write = freshKey();
                call('updateNode', write, {
                  flowId: data.selectedFlowId,
                  nodeId,
                  nodeData: { ...node, ...event.updates },
                });
                writes = writeSent(writes, write);
              }
            }
          }

          return {
            data: {
              writes,
              graph: {
                nodes: updatedNodes,
                edges: data.graph.edges as EdgeEntity[],
                positions: data.graph.positions,
              },
            },
          };
        },
        'NODE.UPDATE_POSITION': (event, { data }) => {
          const permanentId = event.nodeId.startsWith('temp-')
            ? data.tempIdMap[event.nodeId] || event.nodeId
            : event.nodeId;
          return {
            data: {
              graph: {
                nodes: data.graph.nodes as NodeEntity[],
                edges: data.graph.edges as EdgeEntity[],
                positions: {
                  ...data.graph.positions,
                  [permanentId]: { x: event.position.x, y: event.position.y },
                },
              },
            },
          };
        },
        'FLOW.DELETE': (event, { call }) => {
          call('deleteFlow', freshKey(), { flowId: event.flowId });
        },
        'FLOW.UPDATE_LABEL': (event, { call }) => {
          call('updateFlowLabel', freshKey(), { flowId: event.flowId, label: event.label });
        },
        'FLOW.REQUEST_EDIT_LABEL': () => ({ data: { showEditLabelDialog: true } }),
        'FLOW.REQUEST_DELETE': () => ({ data: { showDeleteFlowDialog: true } }),
        'FLOW.DIALOG_CLOSED': () => ({ data: { showEditLabelDialog: false, showDeleteFlowDialog: false } }),
        'GO.BACK': (_event, { data }) => ({
          at: 'list',
          data: {
            ...LEAVE_VIEW,
            navHistory: pushNavHistory(data.navHistory as NavHistory<string | null>, null),
          },
        }),
      },
    },
  },
});

export default flowsState;
