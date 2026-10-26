import { entityIs, viewRead, viewWrites, writeAnswered, writeSent, writing } from '@apackdev/sdk/fe'
import type { OpenEntity } from '@apackdev/sdk/events'
import { and, assign, enqueueActions, setup, type ActorRefFrom } from 'xstate'
import breadcrumb, { breadcrumbWithParams } from '@apackdev/sdk/fe'
import { contextMenuFn } from '@apackdev/sdk/fe'
import { Edit, Trash2 } from 'lucide-vue-next'
import { safeEvents } from '@apackdev/sdk/fe'
import {
  targetIs,
  type TrailClickEvent,
} from '@apackdev/sdk/fe'
import { createNavHistory, pushNavHistory, goBack, goForward, canGoBack, canGoForward } from '@apackdev/sdk/fe'
import type {
  NodeEntity,
  EdgeEntity,
} from '#generated/types.ts'
import type { Contract, FlowsContext, FlowsInboxEvent } from './contract.ts'
import type { FlowExtendedData, OutgoingFlowsEvents } from '#features/flows/be/types.ts'
import { sendToSystem } from '#generated/events.ts'
import { getNodeConfig, isTriggerNode } from '@apackdev/ui/components/node-styles'
import { getStepDeclaration } from '@apackdev/sdk/fe'
import { calculateLayoutAsync, allNodesHavePositions, LAYOUT_CONFIG, layoutComponentAroundSource } from './canvas/layout-utils.ts'
import { computeMaxBottom, type LayoutNodeData } from '@apackdev/ui/components/node-dimensions'
import type { EARS } from '@apackdev/sdk'

const randId = () => Math.random().toString(36).slice(2, 8)

/** Check if a source handle already has an outgoing edge (single-connection-per-handle rule).
 *  Trigger nodes (listener, schedule) are exempt — they support unlimited parallel exits. */
function isHandleOccupied(
  edges: EdgeEntity[],
  nodes: any[],
  sourceNodeId: string,
  sourceHandle?: string,
): boolean {
  const sourceNode = nodes.find((n: any) => n.id === sourceNodeId)
  if (isTriggerNode(sourceNode?.nodeType)) return false

  return edges.some(e => {
    if (e.source !== sourceNodeId) return false
    if (sourceHandle) return e.sourceHandle === sourceHandle
    return !e.sourceHandle
  })
}

/** Scan existing edges from a node and return the next handle index for the given prefix */
function nextHandleIndex(edges: EdgeEntity[], sourceNodeId: string, prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const indices = edges
    .filter(e => e.source === sourceNodeId && e.sourceHandle)
    .map(e => {
      const match = e.sourceHandle!.match(pattern)
      return match ? parseInt(match[1], 10) : -1
    })
    .filter(i => i >= 0)
  return indices.length > 0 ? Math.max(...indices) + 1 : 0
}

/** Shift handle indices on edges when a handle is inserted or removed.
 *  direction=1 (insert): indices >= pivotIndex shift up
 *  direction=-1 (remove): indices > pivotIndex shift down */
function reindexEdges(
  edges: EdgeEntity[], nodeId: string, prefix: string,
  pivotIndex: number, direction: 1 | -1
): EdgeEntity[] {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const threshold = direction === 1 ? pivotIndex : pivotIndex + 1
  return edges.map(edge => {
    if (edge.source !== nodeId || !edge.sourceHandle) return edge
    const m = edge.sourceHandle.match(pattern)
    if (!m) return edge
    const idx = parseInt(m[1], 10)
    if (idx < threshold) return edge
    return { ...edge, sourceHandle: `${prefix}-${idx + direction}` }
  })
}

const HANDLE_OCCUPIED_ERROR = 'This step already has an outbound connection'

/** A graph write, sent where the edit is made: its call recorded in the same assignment, for its answer to settle */
const withWrite = (writes: FlowsContext['writes'], call: string): { writes: FlowsContext['writes'] } =>
  ({ writes: writeSent(writes, call) })

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

/* ─────────────────────────────────────────────────────────── */
/* Machine Types                                               */
/* ─────────────────────────────────────────────────────────── */
export const flowsId = 'flows' as const
export const id = flowsId
export type FlowsState = ActorRefFrom<typeof flowsState>

type SystemEvent = OutgoingFlowsEvents
  | FlowsInboxEvent
  // DSL Import backend responses
  | { type: 'DSL_IMPORTED'; flowIds: string[] }
  | { type: 'DSL_IMPORT_FAILED'; errors: string[] }
  // DSL Export backend responses
  | { type: 'DSL_EXPORTED'; filePath: string; flowCount: number; skipped: string[] }
  | { type: 'DSL_EXPORT_FAILED'; errors: string[] }

type UIEvent =
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
  | { type: 'FLOW.CREATE'; }
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
  // Layout events
  | { type: 'SURFACE_DEACTIVATED' }
  | { type: 'SURFACE_STARTED' }
  | { type: 'LAYOUT_COMPUTED'; graph: FlowsContext['graph']; positions: Record<string, { x: number; y: number }> }

export type FlowsEvents = OpenEntity | UIEvent | SystemEvent | TrailClickEvent
const typeOf = safeEvents<FlowsEvents>()

/** A layout result belongs to the exact graph that requested it. */
function layoutGraph(data: Pick<FlowsContext['graph'], 'nodes' | 'edges'>, positions: FlowsContext['graph']['positions'],
  send: (event: Extract<FlowsEvents, { type: 'LAYOUT_COMPUTED' }>) => void): FlowsContext['graph'] {
  const needsLayout = data.nodes.length > 0 && !allNodesHavePositions(data.nodes, positions);
  const graph = { ...data, positions: needsLayout ? {} : positions };
  if (needsLayout) void calculateLayoutAsync(data).then(positions => send({ type: 'LAYOUT_COMPUTED', graph, positions }));
  return graph;
}

const flowsState = setup({
  types: {
    context: {} as FlowsContext,
    events: {} as FlowsEvents,
  },
  actions: {
    /* ── bootstrap ─────────────────────────────────────── */
    setModelCatalog: assign(({ event }) => ({ models: typeOf('MODEL_CATALOG_READ', event).data.models })),

    takeFlowsRead: assign(({ event }) => {
      const { labels, rootFlowId } = typeOf('FLOWS.READ', event);
      return { flowLabels: labels, rootFlowId };
    }),

    /* ── flow interactions ────────────────────────────── */
    cancelFlowSelection: assign({ pendingFlow: undefined }),
    selectFlow: enqueueActions(({ event, context, enqueue }) => {
      const flowId = event.type === 'OPEN_ENTITY' ? event.id
        : event.type === 'SELECT_ROOT_FLOW' ? context.rootFlowId
        : event.type === 'NAVIGATE_BACK' || event.type === 'NAVIGATE_FORWARD' ? context.navHistory.stack[context.navHistory.index]
        : typeOf(['FLOW.SELECT', 'FLOW.PREVIEW', 'NODE.REVEAL'], event).flowId;
      if (!flowId) return;
      const nodeId = event.type === 'NODE.REVEAL' ? event.nodeId : undefined;
      const recordHistory = event.type !== 'FLOW.PREVIEW' && event.type !== 'NAVIGATE_BACK' && event.type !== 'NAVIGATE_FORWARD';
      // The flow shown already: its graph is the view's current result, so the node is in it or it isn't
      if (context.selectedFlowId === flowId) {
        const found = !nodeId || context.graph.nodes.some(node => node.id === nodeId);
        enqueue.assign({ pendingFlow: undefined,
          ...(nodeId && found && { selectedNodeId: nodeId as EARS.EntityId, editingNodeId: nodeId as EARS.EntityId, canvasError: undefined }),
          ...(!found && { canvasError: `Node "${nodeId}" is no longer in flow "${flowId}".` }),
          ...(recordHistory && { navHistory: pushNavHistory(context.navHistory, flowId) }),
        });
        return;
      }
      // The canvas reads the flow's graph view for it, and the first result opens it (`loadFlowData`)
      enqueue.assign({ pendingFlow: { flowId: flowId as EARS.EntityId, nodeId, recordHistory }, canvasError: undefined });
    }),

    /** The flow asked for, opened: its graph view's first result */
    loadFlowData: assign(({ context, event, self }) => {
      const ev = typeOf('FLOW.GRAPH_READ', event);
      const data = ev.data!;
      const request = context.pendingFlow;
      const nodeId = request?.nodeId;
      const found = nodeId && data.nodes.some(node => node.id === nodeId);
      return {
        pendingFlow: undefined,
        selectedFlowId: ev.flowId,
        selectedNodeId: found ? nodeId as EARS.EntityId : undefined,
        editingNodeId: found ? nodeId as EARS.EntityId : undefined,
        canvasError: nodeId && !found ? `Node "${nodeId}" is no longer in flow "${ev.flowId}".` : undefined,
        graph: layoutGraph(data, context.selectedFlowId === ev.flowId ? context.graph.positions : {}, event => self.send(event)),
        navHistory: request?.recordHistory ? pushNavHistory(context.navHistory, ev.flowId) : context.navHistory,
        writes: viewRead(context.writes).writes,
      };
    }),

    /** The flow asked for was gone by the time its view read it */
    dropGoneFlow: assign(({ event }) => {
      const { flowId } = typeOf('FLOW.GRAPH_READ', event);
      return { pendingFlow: undefined, canvasError: `Flow "${flowId}" was deleted before it could be opened.` };
    }),

    /**
     * The shown flow again, as its view now reads it, which every write — this window's or another's — brings: the
     * node selection and editor stay where their node does, and positions stay where the user put them.
     */
    loadRefreshedFlow: assign(({ context, event, self }) => {
      const ev = typeOf('FLOW.GRAPH_READ', event);
      const data = ev.data!;
      const kept = (node: EARS.EntityId | undefined) => node && data.nodes.some(each => each.id === node) ? node : undefined;
      return {
        selectedNodeId: kept(context.selectedNodeId),
        editingNodeId: kept(context.editingNodeId),
        graph: layoutGraph(data, context.graph.positions, event => self.send(event)),
        writes: viewRead(context.writes).writes,
      };
    }),

    /** A result that may predate a write still unanswered: applying it would undo that edit on screen */
    holdGraph: assign(({ context }) => ({ writes: viewRead(context.writes).writes })),

    /** The shown flow is gone — deleted here or in another window */
    leaveGoneFlow: assign({
      selectedFlowId: undefined,
      selectedNodeId: undefined,
      editingNodeId: undefined,
      graph: { nodes: [], edges: [], positions: {} },
      writes: viewWrites(),
    }),

    /** One of the editor's writes answered: once the last is, the graph is read again if a result was held or one was refused */
    settleWrite: assign(({ context, event }) => ({ writes: writeAnswered(context.writes, event, event.type === 'FLOW_WRITE_FAILED') })),

    surfaceWriteError: assign(({ event }) => ({ canvasError: typeOf('FLOW_WRITE_FAILED', event).error })),

    sendCreateFlow: ({ event }) => {
      typeOf('FLOW.CREATE', event);
      sendToSystem(id, { type: 'CREATE_FLOW' });
    },

    sendUpdateLabel: ({ event }) => {
      const ev = typeOf('FLOW.UPDATE_LABEL', event);
      sendToSystem(id, {
        type: 'UPDATE_FLOW_LABEL',
        flowId: ev.flowId,
        label: ev.label,
      });
    },

    /** The flow *this* window asked to create, which this window opens; every window's list has it from its view */
    openCreatedFlow: assign(({ event }) => ({
      pendingFlow: { flowId: typeOf('FLOW_OPENED', event).flowId, recordHistory: true },
      selectedNodeId: undefined,
      editingNodeId: undefined,
    })),

    sendDeleteFlow: ({ event }) => {
      const ev = event as { type: 'FLOW.DELETE'; flowId: EARS.EntityId };
      if (ev.type !== 'FLOW.DELETE') return;

      sendToSystem(id, {
        type: 'DELETE_FLOW',
        flowId: ev.flowId as string,
      });
    },

    /* ── graph interactions ───────────────────────────────── */
    selectNode: assign({ selectedNodeId: ({ event }) => typeOf('NODE.CLICK', event).nodeId as EARS.EntityId }),
    handleSelectionChange: assign(({ event }) => {
      const ev = typeOf('NODE.SELECTION_CHANGE', event);
      if (ev.selected && ev.nodeId) {
        return { selectedNodeId: ev.nodeId as EARS.EntityId };
      } else {
        return { selectedNodeId: undefined };
      }
    }),
    editNode: assign({ editingNodeId: ({ event }) => typeOf('NODE.DOUBLE_CLICK', event).nodeId as EARS.EntityId }),
    closeNodeEditor: assign({ editingNodeId: undefined }),
    
    selectAndEditFirstNode: assign(({ context }) => {
      // Get the first node from the current flow
      const firstNode = context.graph.nodes[0];
      if (!firstNode) {
        console.warn('No nodes available to edit');
        return {};
      }
      
      // Return both selected and editing node IDs
      return {
        selectedNodeId: firstNode.id as EARS.EntityId,
        editingNodeId: firstNode.id as EARS.EntityId
      };
    }),
    connectEdge: assign(({ context, event }) => {
      const ev = typeOf('EDGE.CONNECT', event)
      // Guard: self-connection
      if (ev.src === ev.tgt) return {}
      // Guard: duplicate edge
      const alreadyConnected = context.graph.edges.some(
        (e) => e.source === ev.src && e.target === ev.tgt
      )
      if (alreadyConnected) return {}
      // Guard: target is a trigger node (no inputs)
      const targetNode = context.graph.nodes.find(n => n.id === ev.tgt)
      if (isTriggerNode(targetNode?.nodeType)) return {}
      // Guard: source handle already occupied (except listeners)
      if (isHandleOccupied(context.graph.edges, context.graph.nodes, ev.src, ev.sourceHandle)) return { canvasError: HANDLE_OCCUPIED_ERROR }
      const id = `Edge-${randId()}`
      const newEdge = {
        id,
        source: ev.src,
        target: ev.tgt,
        kind: 'transitions_to',
        // Store handle info for switch nodes with multiple outputs
        sourceHandle: ev.sourceHandle,
        targetHandle: ev.targetHandle,
      } as EdgeEntity

      return {
        graph: {
          ...context.graph,
          edges: [...context.graph.edges, newEdge],
        },
      }
    }),
    
    sendEdgeConnected: assign(({ context, event }) => {
      const ev = typeOf('EDGE.CONNECT', event);
      if (!context.selectedFlowId) return {};

      // Only send if both IDs are permanent (not temporary)
      if (!ev.src.startsWith('temp-') && !ev.tgt.startsWith('temp-')) {
        return withWrite(context.writes, sendToSystem(id, {
          type: 'CREATE_EDGE',
          flowId: context.selectedFlowId,
          sourceId: ev.src,
          targetId: ev.tgt,
          sourceHandle: ev.sourceHandle,
          targetHandle: ev.targetHandle,
        }));
      }
      // A node still being added: its answer sends the edge (`reconcileNodeId`)
      return {};
    }),
    
    disconnectEdge: assign(({ context, event }) => {
      const ev = typeOf('EDGE.DISCONNECT', event);
      
      return { 
        graph: {
          ...context.graph,
          edges: context.graph.edges.filter(edge => edge.id !== ev.edgeId),
        },
      }
    }),
    
    sendEdgeDisconnected: assign(({ context, event }) => {
      const ev = typeOf('EDGE.DISCONNECT', event);
      if (!context.selectedFlowId) return {};
      return withWrite(context.writes, sendToSystem(id, {
        type: 'DELETE_EDGE',
        flowId: context.selectedFlowId,
        edgeId: ev.edgeId,
      }));
    }),
    
    reconnectEdge: assign(({ context, event }) => {
      const ev = typeOf('EDGE.RECONNECT', event);
      const edges = context.graph.edges.map(edge => edge.id === ev.edgeId
        ? { ...edge, source: ev.source as EARS.EntityId, target: ev.target as EARS.EntityId, sourceHandle: ev.sourceHandle, targetHandle: ev.targetHandle }
        : edge);
      return { graph: { ...context.graph, edges } };
    }),

    sendEdgeReconnected: assign(({ context, event }) => {
      const ev = typeOf('EDGE.RECONNECT', event);
      if (!context.selectedFlowId) return {};
      return withWrite(context.writes, sendToSystem(id, {
        type: 'UPDATE_EDGE',
        flowId: context.selectedFlowId,
        edgeId: ev.edgeId,
        source: ev.source,
        target: ev.target,
        sourceHandle: ev.sourceHandle,
        targetHandle: ev.targetHandle,
      }));
    }),
    
    deselectNode: assign({ selectedNodeId: undefined, editingNodeId: undefined }),

    // Handle selection for click-to-connect
    selectHandle: assign(({ event }) => {
      const ev = typeOf('HANDLE.SELECT', event);
      return {
        selectedHandle: {
          nodeId: ev.nodeId,
          handleId: ev.handleId,
        },
      };
    }),

    deselectHandle: assign({ selectedHandle: undefined }),
    clearCanvasError: assign({ canvasError: undefined }),

    reindexHandles: assign(({ context, event }) => {
      const ev = typeOf('HANDLE.REINDEX', event)
      const updatedEdges = reindexEdges(
        context.graph.edges, ev.nodeId, ev.prefix, ev.index, ev.direction
      )
      return { graph: { ...context.graph, edges: updatedEdges } }
    }),

    sendReindexHandles: assign(({ context, event }) => {
      const ev = typeOf('HANDLE.REINDEX', event)
      if (!context.selectedFlowId) return {}
      const nodeId = ev.nodeId.startsWith('temp-')
        ? context.tempIdMap[ev.nodeId] || ev.nodeId
        : ev.nodeId
      if (nodeId.startsWith('temp-')) return {}

      return withWrite(context.writes, sendToSystem(id, {
        type: 'REINDEX_HANDLES',
        flowId: context.selectedFlowId,
        nodeId,
        prefix: ev.prefix,
        index: ev.index,
        direction: ev.direction,
      }))
    }),

    // Connect from selected handle to clicked node and send to backend
    // Combined into single action to ensure handle is captured before being cleared
    connectFromHandleAndSend: assign(({ context, event }) => {
      const ev = typeOf('NODE.CLICK', event);
      const handle = context.selectedHandle;
      if (!handle) return { selectedNodeId: ev.nodeId as EARS.EntityId, selectedHandle: undefined };

      // Don't connect to self — select the node and clear handle instead
      if (handle.nodeId === ev.nodeId) return { selectedNodeId: ev.nodeId as EARS.EntityId, selectedHandle: undefined };

      // Don't create duplicate edge to an already-connected target
      const alreadyConnected = context.graph.edges.some(
        (e) => e.source === handle.nodeId && e.target === ev.nodeId
      );
      if (alreadyConnected) return { selectedNodeId: ev.nodeId as EARS.EntityId, selectedHandle: undefined };

      // Don't connect to trigger nodes (no inputs)
      const clickedNode = context.graph.nodes.find(n => n.id === ev.nodeId);
      if (isTriggerNode(clickedNode?.nodeType)) return { selectedNodeId: ev.nodeId as EARS.EntityId, selectedHandle: undefined };

      // Don't connect if source handle already has an outgoing edge (except listeners)
      if (isHandleOccupied(context.graph.edges, context.graph.nodes, handle.nodeId, handle.handleId)) {
        return { selectedNodeId: ev.nodeId as EARS.EntityId, selectedHandle: undefined, canvasError: HANDLE_OCCUPIED_ERROR };
      }

      const edgeId = `Edge-${randId()}`;
      const newEdge = {
        id: edgeId,
        source: handle.nodeId,
        target: ev.nodeId,
        kind: 'transitions_to',
        sourceHandle: handle.handleId,
      } as EdgeEntity;

      // Send to backend (handle is still available here, before we clear it)
      const sent = context.selectedFlowId && !handle.nodeId.startsWith('temp-') && !ev.nodeId.startsWith('temp-')
        ? withWrite(context.writes, sendToSystem(id, {
          type: 'CREATE_EDGE',
          flowId: context.selectedFlowId,
          sourceId: handle.nodeId,
          targetId: ev.nodeId,
          sourceHandle: handle.handleId,
        }))
        : {};

      return {
        ...sent,
        graph: {
          ...context.graph,
          edges: [...context.graph.edges, newEdge],
        },
        selectedHandle: undefined, // Clear selection after connecting
      };
    }),

    deleteNode: assign(({ context, event }) => {
      const ev = typeOf('NODE.DELETE', event);
      const nodeId = ev.nodeId;
      
      // Remove the node from the graph
      const updatedNodes = context.graph.nodes.filter(n => n.id !== nodeId);
      
      // Also remove any edges connected to this node
      const updatedEdges = context.graph.edges.filter(edge => 
        edge.source !== nodeId && edge.target !== nodeId
      );
      
      // Clear selection if the deleted node was selected or being edited
      const newSelectedNodeId = context.selectedNodeId === nodeId ? undefined : context.selectedNodeId;
      const newEditingNodeId = context.editingNodeId === nodeId ? undefined : context.editingNodeId;
      
      return {
        graph: {
          ...context.graph,
          nodes: updatedNodes,
          edges: updatedEdges,
        },
        selectedNodeId: newSelectedNodeId,
        editingNodeId: newEditingNodeId,
      };
    }),
    
    sendNodeDeleted: assign(({ context, event }) => {
      const ev = typeOf('NODE.DELETE', event);
      if (!context.selectedFlowId) return {};
      return withWrite(context.writes, sendToSystem(id, {
        type: 'DELETE_NODE',
        flowId: context.selectedFlowId,
        nodeId: ev.nodeId,
      }));
    }),

    createNode: assign(({ context, event, self }) => {
      if (!context.selectedFlowId) return { selectedNodeId: undefined }

      const tempId = `temp-${randId()}`
      const ev = typeOf('NODE.CREATE', event)
      const nodeConfig = getNodeConfig(ev.nodeType)
      const label = nodeConfig?.defaultLabel || nodeConfig?.label || `New ${ev.nodeType}`

      const sent = withWrite(context.writes, sendToSystem(id, {
        type: 'CREATE_NODE',
        flowId: context.selectedFlowId,
        tempId,
        nodeData: { nodeType: ev.nodeType, label },
      }));

      // Calculate position based on node type and selection state
      const { newNode: nodeOffset } = LAYOUT_CONFIG
      const positions = context.graph.positions
      const allPos = Object.values(positions)
      const isListener = nodeConfig?.connectionRules.inputs === 0

      // "Below all nodes" position for new tracks or unconnected steps
      // Compute the actual bottom of all nodes (accounting for dynamic heights like multi-exit listeners)
      const maxBottom = allPos.length > 0
        ? computeMaxBottom(context.graph.nodes as LayoutNodeData[], positions, context.graph.edges)
        : 0

      // Use the x-position of an existing trigger node so the new node aligns with
      // ELK-laid-out tracks (ELK may add internal padding, so x is often non-zero).
      const existingListenerX = context.graph.nodes
        .find(n => isTriggerNode(n.nodeType) && positions[n.id])
      const alignX = existingListenerX ? positions[existingListenerX.id].x : 0

      const belowAllPos = maxBottom > 0
        ? { x: alignX, y: maxBottom + LAYOUT_CONFIG.chainGap }
        : { x: nodeOffset.defaultX, y: nodeOffset.defaultY }

      let newPosition: { x: number; y: number }
      let autoEdge: EdgeEntity | null = null
      let handleBlocked = false

      if (ev.position) {
        // Drag-drop: use explicit position
        newPosition = ev.position
      } else if (isListener) {
        // Listeners start new tracks — always place below
        newPosition = belowAllPos
      } else if (context.selectedNodeId && positions[context.selectedNodeId]) {
        // Step with selected node — place to the right and auto-connect
        const selectedPos = positions[context.selectedNodeId]
        newPosition = { x: selectedPos.x + nodeOffset.xOffset, y: selectedPos.y + nodeOffset.yOffset }

        // Auto-create edge unless selected node has no outputs (fire/kill)
        const selectedNode = context.graph.nodes.find(n => n.id === context.selectedNodeId)
        const selectedConfig = selectedNode ? getNodeConfig(selectedNode.nodeType) : null
        if (selectedConfig?.connectionRules.outputs !== 0) {
          // For listeners, assign the next available exit handle
          let sourceHandle: string | undefined
          if (selectedConfig?.connectionRules.inputs === 0) {
            const existingExits = context.graph.edges
              .filter(e => e.source === context.selectedNodeId && e.sourceHandle)
              .map(e => {
                const match = e.sourceHandle!.match(/exit-(\d+)/)
                return match ? parseInt(match[1], 10) : -1
              })
            const nextIndex = existingExits.length > 0 ? Math.max(...existingExits) + 1 : 0
            sourceHandle = `exit-${nextIndex}`
          } else if (selectedNode?.nodeType) {
            const prefix = getStepDeclaration(selectedNode.nodeType)?.declaration.fe?.handlePrefix;
            if (prefix) {
              sourceHandle = `${prefix}-${nextHandleIndex(context.graph.edges, context.selectedNodeId!, prefix)}`;
            }
          }

          // Only auto-connect if handle is not already occupied
          if (!isHandleOccupied(context.graph.edges, context.graph.nodes, context.selectedNodeId!, sourceHandle)) {
            const tempEdgeId = `Edge-${randId()}`
            autoEdge = {
              id: tempEdgeId,
              source: context.selectedNodeId,
              target: tempId,
              kind: 'transitions_to',
              ...(sourceHandle && { sourceHandle }),
            } as EdgeEntity
          } else {
            // Handle occupied — skip auto-connect, place below instead
            handleBlocked = true
            newPosition = belowAllPos
          }
        }
      } else {
        // Step with no selection — place below all nodes
        newPosition = belowAllPos
      }

      const tempNodeData: any = { id: tempId, nodeType: ev.nodeType, label, flowId: context.selectedFlowId, configuration: {} }
      applyNodeTypeDefaults(tempNodeData)

      // Async ELK layout to snap the new node and reposition siblings in the same component
      if (autoEdge && context.selectedNodeId) {
        layoutComponentAroundSource(
          context.selectedNodeId,
          [...context.graph.nodes, tempNodeData],
          [...context.graph.edges, autoEdge],
          positions,
          (nodeId, position) => self.send({ type: 'NODE.UPDATE_POSITION', nodeId, position })
        )
      }

      return {
        ...sent,
        graph: {
          ...context.graph,
          nodes: [...context.graph.nodes, tempNodeData],
          edges: autoEdge ? [...context.graph.edges, autoEdge] : context.graph.edges,
          positions: { ...positions, [tempId]: newPosition },
        },
        selectedNodeId: tempId as EARS.EntityId,
        tempIdMap: { ...context.tempIdMap, [tempId]: tempId },
        canvasError: handleBlocked ? HANDLE_OCCUPIED_ERROR : undefined,
      }
    }),

    createConnectedNode: assign(({ context, event, self }) => {
      if (!context.selectedFlowId) {
        return { selectedNodeId: undefined }
      }

      const tempId = `temp-${randId()}`
      const ev = typeOf('NODE.CREATE_CONNECTED', event)

      // Get the default label from node config
      const nodeConfig = getNodeConfig(ev.nodeType)
      const defaultLabel = nodeConfig?.defaultLabel || nodeConfig?.label || `New ${ev.nodeType}`

      const newNode: any = {
        id: tempId,
        nodeType: ev.nodeType,
        label: defaultLabel,
        flowId: context.selectedFlowId,
        configuration: {},
      }
      applyNodeTypeDefaults(newNode)

      // Calculate position: to the right of the source node
      const { newNode: nodeOffset } = LAYOUT_CONFIG
      const positions = context.graph.positions
      const sourcePos = positions[ev.sourceNodeId]
      const newPosition = sourcePos
        ? { x: sourcePos.x + nodeOffset.xOffset, y: sourcePos.y + nodeOffset.yOffset }
        : { x: nodeOffset.fallbackX, y: nodeOffset.fallbackY }

      // Resolve sourceHandle — fallback to next handle index for multi-exit nodes
      let resolvedSourceHandle = ev.sourceHandle
      if (!resolvedSourceHandle) {
        const sourceNode = context.graph.nodes.find(n => n.id === ev.sourceNodeId)
        const handlePrefix = sourceNode?.nodeType ? getStepDeclaration(sourceNode.nodeType)?.declaration.fe?.handlePrefix : undefined;
        if (handlePrefix) {
          resolvedSourceHandle = `${handlePrefix}-${nextHandleIndex(context.graph.edges, ev.sourceNodeId, handlePrefix)}`;
        } else if (isTriggerNode(sourceNode?.nodeType)) {
          const existingExits = context.graph.edges
            .filter(e => e.source === ev.sourceNodeId && e.sourceHandle)
            .map(e => {
              const match = e.sourceHandle!.match(/exit-(\d+)/)
              return match ? parseInt(match[1], 10) : -1
            })
          const nextIndex = existingExits.length > 0 ? Math.max(...existingExits) + 1 : 0
          resolvedSourceHandle = `exit-${nextIndex}`
        }
      }

      // Don't connect if source handle already occupied (except listeners)
      if (isHandleOccupied(context.graph.edges, context.graph.nodes, ev.sourceNodeId, resolvedSourceHandle)) {
        return { canvasError: HANDLE_OCCUPIED_ERROR }
      }

      // Create temporary edge
      const tempEdgeId = `Edge-${randId()}`
      const tempEdge: EdgeEntity = {
        id: tempEdgeId,
        source: ev.sourceNodeId,
        target: tempId,
        kind: 'transitions_to',
        sourceHandle: resolvedSourceHandle,
      } as EdgeEntity

      // Send create to backend
      const sent = withWrite(context.writes, sendToSystem(id, {
        type: 'CREATE_NODE',
        flowId: context.selectedFlowId,
        tempId: tempId,
        nodeData: {
          nodeType: ev.nodeType,
          label: newNode.label,
        },
      }));

      // Async ELK layout to snap the new node and reposition siblings in the same component
      layoutComponentAroundSource(
        ev.sourceNodeId,
        [...context.graph.nodes, newNode],
        [...context.graph.edges, tempEdge],
        positions,
        (nodeId, position) => self.send({ type: 'NODE.UPDATE_POSITION', nodeId, position })
      )

      return {
        ...sent,
        graph: {
          ...context.graph,
          nodes: [...context.graph.nodes, newNode],
          edges: [...context.graph.edges, tempEdge],
          positions: { ...positions, [tempId]: newPosition },
        },
        selectedNodeId: tempId as EARS.EntityId,
        editingNodeId: tempId as EARS.EntityId,
        tempIdMap: {
          ...context.tempIdMap,
          [tempId]: tempId,
        }
      }
    }),

    /* ── node update actions ──────────────────────────────── */
    updateNode: assign(({ context, event }) => {
      const ev = typeOf('NODE.UPDATE', event);
      return {
        graph: {
          ...context.graph,
          nodes: context.graph.nodes.map((node) =>
            node.id === ev.nodeId ? { ...node, ...ev.updates } : node
          ) as any[], // Temporary fix for mixed node types
        },
      };
    }),

    sendNodeUpdate: assign(({ context, event }) => {
      const ev = typeOf('NODE.UPDATE', event);
      if (!context.selectedFlowId) return {};
      
      // Check if this is a temporary ID
      const nodeId = ev.nodeId.startsWith('temp-') 
        ? context.tempIdMap[ev.nodeId] || ev.nodeId
        : ev.nodeId;
      
      // If it's still temporary (not yet resolved), skip the update
      if (nodeId.startsWith('temp-')) {
        console.warn('Cannot update node with temporary ID:', nodeId);
        return {};
      }
      
      const node = context.graph.nodes.find(n => n.id === nodeId);
      if (!node) return {};

      // Send update to backend
      return withWrite(context.writes, sendToSystem(id, {
        type: 'UPDATE_NODE',
        flowId: context.selectedFlowId,
        nodeId: nodeId,
        nodeData: { ...node, ...ev.updates },
      }));
    }),

    updateNodePosition: assign(({ context, event }) => {
      const ev = typeOf('NODE.UPDATE_POSITION', event);
      const nodeId = ev.nodeId;
      
      // Check if we need to use the permanent ID from tempIdMap
      const permanentId = nodeId.startsWith('temp-') 
        ? context.tempIdMap[nodeId] || nodeId
        : nodeId;
      
      return {
        graph: {
          ...context.graph,
          positions: {
            ...context.graph.positions,
            // Use the permanent ID for position storage if available
            [permanentId]: { x: ev.position.x, y: ev.position.y }
          }
        },
      };
    }),

    /* ── ID reconciliation actions ────────────────────────── */
    reconcileNodeId: assign(({ context, event }) => {
      const ev = typeOf('NODE_CREATED', event);
      const { tempId, nodeId: permanentId, node } = ev;
      
      // The node from backend already has the permanent ID, just replace the temp node. A refresh may already
      // have brought the permanent node, and then the temp one is only dropped
      const arrived = context.graph.nodes.some(n => n.id === permanentId);
      const updatedNodes = arrived ? context.graph.nodes.filter(n => n.id !== tempId)
        : context.graph.nodes.map(n => n.id === tempId ? node : n);
      
      // Update selected node ID if it was the temp one
      const newSelectedNodeId = context.selectedNodeId === tempId 
        ? permanentId 
        : context.selectedNodeId;
      
      // Update editing node ID if it was the temp one
      const newEditingNodeId = context.editingNodeId === tempId
        ? permanentId
        : context.editingNodeId;
      
      // Update edges that reference the temporary ID
      const updatedEdges = context.graph.edges.map(edge => ({
        ...edge,
        source: edge.source === tempId ? permanentId : edge.source,
        target: edge.target === tempId ? permanentId : edge.target,
      }));
      
      // Update positions if needed
      const updatedPositions = { ...context.graph.positions };
      if (updatedPositions[tempId]) {
        updatedPositions[permanentId] = updatedPositions[tempId];
        delete updatedPositions[tempId];
      }
      
      // Update tempIdMap
      const updatedTempIdMap = { ...context.tempIdMap };
      updatedTempIdMap[tempId] = permanentId;
      
      // Send edge creation to backend for any edges with the new permanent ID
      let writes = context.writes;
      if (context.selectedFlowId) {
        updatedEdges.forEach(edge => {
          // If this edge was just updated from temp to permanent, send it
          const wasUpdated = (edge.source === permanentId && context.graph.edges.find(e => e.id === edge.id)?.source === tempId)
            || (edge.target === permanentId && context.graph.edges.find(e => e.id === edge.id)?.target === tempId);
          
          if (wasUpdated && !edge.source.startsWith('temp-') && !edge.target.startsWith('temp-')) {
            writes = withWrite(writes, sendToSystem(id, {
              type: 'CREATE_EDGE',
              flowId: context.selectedFlowId!,
              sourceId: edge.source,
              targetId: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
            })).writes;
          }
        });
      }
      
      return {
        graph: {
          nodes: updatedNodes,
          edges: updatedEdges,
          positions: updatedPositions,
        },
        selectedNodeId: newSelectedNodeId,
        editingNodeId: newEditingNodeId,
        tempIdMap: updatedTempIdMap,
        writes,
      };
    }),
    
    /* ── Edge ID reconciliation ────────────────────────────── */
    reconcileEdgeId: assign(({ context, event }) => {
      const ev = typeOf('EDGE_CREATED', event);
      const { sourceId, targetId, relId, sourceHandle, targetHandle } = ev;

      // Find the edge with matching source, target, and handles
      const updatedEdges = context.graph.edges.map(edge => {
        const sourceMatches = edge.source === sourceId;
        const targetMatches = edge.target === targetId;
        // For switch nodes, also match by handle to differentiate branches
        // Normalize null/undefined to avoid mismatches
        const sourceHandleMatches = (sourceHandle || null) === (edge.sourceHandle || null);
        const targetHandleMatches = (targetHandle || null) === (edge.targetHandle || null);

        if (sourceMatches && targetMatches && sourceHandleMatches && targetHandleMatches) {
          // Update the edge ID to the real relation ID
          return { ...edge, id: relId as EARS.EntityId };
        }
        return edge;
      });

      return {
        graph: {
          ...context.graph,
          edges: updatedEdges,
        },
      };
    }),
    
    /* ── DSL Import actions ────────────────────────────────── */
    setImporting: assign(({ context }) => ({
      dslImport: {
        ...context.dslImport,
        status: 'importing' as const,
      },
    })),

    sendImportDSL: ({ event }) => {
      const ev = typeOf('DSL.IMPORT', event);
      sendToSystem(id, {
        type: 'IMPORT_DSL',
        dsl: ev.dsl,
      });
    },

    handleDSLImported: assign(({ context, event }) => {
      typeOf('DSL_IMPORTED', event);
      return {
        dslImport: {
          status: 'success' as const,
          errors: [],
          importedFlowNames: context.dslImport.importedFlowNames, // Keep the names we parsed from file
        },
      };
    }),

    handleDSLImportFailed: assign(({ event }) => {
      const ev = typeOf('DSL_IMPORT_FAILED', event);
      return {
        dslImport: {
          status: 'error' as const,
          errors: ev.errors,
          importedFlowNames: [],
        },
      };
    }),

    setFlowNamesFromDSL: assign(({ context, event }) => {
      const ev = typeOf('DSL.IMPORT', event);
      return {
        dslImport: {
          ...context.dslImport,
          importedFlowNames: ev.flowNames,
        },
      };
    }),

    resetImportStatus: assign({
      dslImport: { status: 'idle' as const, errors: [], importedFlowNames: [] },
    }),

    /* ── DSL Export actions ────────────────────────────────── */
    setExporting: assign(({ context }) => ({
      dslExport: {
        ...context.dslExport,
        status: 'exporting' as const,
      },
    })),

    sendExportDSL: ({ event }) => {
      const ev = typeOf('DSL.EXPORT', event);
      sendToSystem(id, {
        type: 'EXPORT_DSL',
        directory: ev.directory,
        ...(ev.flowId && { flowId: ev.flowId }),
      });
    },

    handleDSLExported: assign(({ event }) => {
      const ev = typeOf('DSL_EXPORTED', event);
      return {
        dslExport: {
          status: 'success' as const,
          errors: [],
          filePath: ev.filePath,
          flowCount: ev.flowCount,
          skipped: ev.skipped,
        },
      };
    }),

    handleDSLExportFailed: assign(({ event }) => {
      const ev = typeOf('DSL_EXPORT_FAILED', event);
      return {
        dslExport: {
          status: 'error' as const,
          errors: ev.errors,
          filePath: '',
          flowCount: 0,
          skipped: [],
        },
      };
    }),

    resetExportStatus: assign({
      dslExport: { status: 'idle' as const, errors: [], filePath: '', flowCount: 0, skipped: [] as string[] },
    }),

    /* ── Context menu dialog bridge actions ───────────────── */
    requestEditLabel: assign({ showEditLabelDialog: true }),
    requestDeleteFlow: assign({ showDeleteFlowDialog: true }),
    closeDialogs: assign({ showEditLabelDialog: false, showDeleteFlowDialog: false }),
  },
  guards: { entityIs: entityIs<Contract['opens']>,
    targetIs,
    /** Whether a graph read is for the flow the user asked to open */
    readsPendingFlow: ({ context, event }) => event.type === 'FLOW.GRAPH_READ' && context.pendingFlow?.flowId === event.flowId,
    /** Whether a graph read is for the flow shown, with no other being opened in its place */
    readsShownFlow: ({ context, event }) => event.type === 'FLOW.GRAPH_READ' && !context.pendingFlow && context.selectedFlowId === event.flowId,
    readsNothing: ({ event }) => event.type === 'FLOW.GRAPH_READ' && event.data === null,
    /** Whether any of the editor's writes is unanswered */
    writing: ({ context }) => writing(context.writes),
    hasSelectedHandle: ({ context }) => !!context.selectedHandle,
  },
}).createMachine({
  id,
  initial: 'list',
  context: {
    selectedNodeId: undefined,
    editingNodeId: undefined,
    selectedFlowId: undefined,
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
  },
  on: {
    OPEN_ENTITY: { guard: { type: 'entityIs', params: { entity: 'Flow' } }, target: '.view', actions: 'selectFlow' },
    'FLOW.SELECT': { target: '.view', actions: 'selectFlow' },
    'NODE.REVEAL': { target: '.view', actions: 'selectFlow' },
    SURFACE_DEACTIVATED: { actions: 'cancelFlowSelection' },
    // The models the editor offers, asked as the shell starts the surface, in a delivery naming it
    SURFACE_STARTED: { actions: () => { sendToSystem(id, { type: 'GET_MODEL_CATALOG' }); } },
    MODEL_CATALOG_READ: { actions: 'setModelCatalog' },
    'FLOWS.READ': { actions: 'takeFlowsRead' },
    'ROOT_FLOW.SET': {
      actions: ({ event }) => sendToSystem(id, { type: 'SET_ROOT_FLOW', flowId: typeOf('ROOT_FLOW.SET', event).flowId }),
    },
    'FLOW.GRAPH_READ': [
      { guard: and(['readsPendingFlow', 'readsNothing']), actions: 'dropGoneFlow' },
      { guard: 'readsPendingFlow', actions: 'loadFlowData' },
      { guard: and(['readsShownFlow', 'readsNothing']), target: '.list', actions: 'leaveGoneFlow' },
      { guard: and(['readsShownFlow', 'writing']), actions: 'holdGraph' },
      { guard: 'readsShownFlow', actions: 'loadRefreshedFlow' },
    ],
    LAYOUT_COMPUTED: {
      // Node ids are unique to a flow, so a shared node means the same flow, however often its graph was rebuilt
      // since the layout was asked for; another flow's late layout shares none and is dropped
      guard: ({ context, event }) => event.graph.nodes.some(node => context.graph.nodes.some(current => current.id === node.id)),
      actions: assign(({ context, event }) => {
        const ev = typeOf('LAYOUT_COMPUTED', event)
        const computed = Object.fromEntries(context.graph.nodes.flatMap(node => ev.positions[node.id] ? [[node.id, ev.positions[node.id]]] : []))
        return {
          graph: {
            ...context.graph,
            positions: { ...computed, ...context.graph.positions },
          },
        }
      }),
    },
    // The answer, which only the window that asked is sent — so only it navigates
    FLOW_OPENED: {
      actions: 'openCreatedFlow',
      target: '.view'
    },
    // The answers to the editor's writes
    NODE_CREATED: { actions: ['reconcileNodeId', 'settleWrite'] },
    EDGE_CREATED: { actions: ['reconcileEdgeId', 'settleWrite'] },
    FLOW_WRITTEN: { actions: 'settleWrite' },
    // A refused write: its reason, and the flow as stored read again once nothing else is unanswered
    FLOW_WRITE_FAILED: { actions: ['surfaceWriteError', 'settleWrite'] },
    'CANVAS.CLEAR_ERROR': {
      actions: 'clearCanvasError',
    },
    // DSL Import events
    'DSL.IMPORT': {
      actions: ['setFlowNamesFromDSL', 'setImporting', 'sendImportDSL']
    },
    'DSL.RESET_STATUS': {
      actions: 'resetImportStatus'
    },
    DSL_IMPORTED: {
      actions: 'handleDSLImported'
    },
    DSL_IMPORT_FAILED: {
      actions: 'handleDSLImportFailed'
    },
    // DSL Export events
    'DSL.EXPORT': {
      actions: ['setExporting', 'sendExportDSL']
    },
    'DSL.RESET_EXPORT_STATUS': {
      actions: 'resetExportStatus'
    },
    DSL_EXPORTED: {
      actions: 'handleDSLExported'
    },
    DSL_EXPORT_FAILED: {
      actions: 'handleDSLExportFailed'
    },
    NAVIGATE_BACK: [
      {
        guard: ({ context }) => {
          if (!canGoBack(context.navHistory)) return false;
          return context.navHistory.stack[context.navHistory.index - 1] === null;
        },
        target: '.list',
        actions: assign(({ context }) => {
          const result = goBack(context.navHistory)!;
          return { navHistory: result.history, selectedFlowId: undefined };
        }),
      },
      {
        guard: ({ context }) => {
          if (!canGoBack(context.navHistory)) return false;
          const target = context.navHistory.stack[context.navHistory.index - 1];
          return target !== null && target in context.flowLabels;
        },
        target: '.view',
        actions: [assign(({ context }) => ({ navHistory: goBack(context.navHistory)!.history })), 'selectFlow'],
      },
    ],
    NAVIGATE_FORWARD: [
      {
        guard: ({ context }) => {
          if (!canGoForward(context.navHistory)) return false;
          return context.navHistory.stack[context.navHistory.index + 1] === null;
        },
        target: '.list',
        actions: assign(({ context }) => {
          const result = goForward(context.navHistory)!;
          return { navHistory: result.history, selectedFlowId: undefined };
        }),
      },
      {
        guard: ({ context }) => {
          if (!canGoForward(context.navHistory)) return false;
          const target = context.navHistory.stack[context.navHistory.index + 1];
          return target !== null && target in context.flowLabels;
        },
        target: '.view',
        actions: [assign(({ context }) => ({ navHistory: goForward(context.navHistory)!.history })), 'selectFlow'],
      },
    ],
    TRAIL_CLICK: [
      {
        guard: { type: 'targetIs', params: { view: 'list' } },
        target: '.list',
        actions: assign(({ context }) => ({ navHistory: pushNavHistory(context.navHistory, null) })),
      },
      {
        guard: { type: 'targetIs', params: { view: 'view' } },
        target: '.view',
      },
    ],
  },
  states: {
    list: {
      entry: 'cancelFlowSelection',
      tags: ['list-flows'],
      meta: { ...breadcrumb('list', 'Flows', true) },
      on: {
        'FLOW.PREVIEW': {
          actions: 'selectFlow',
          // Stay in list state - just load the flow data
        },
        'SELECT_ROOT_FLOW': {
          actions: 'selectFlow',
          target: 'view',
        },
        'FLOW.CREATE': {
          actions: 'sendCreateFlow',
        },
        'FLOW.DELETE': {
          actions: 'sendDeleteFlow',
        },
        'FLOW.UPDATE_LABEL': {
          actions: 'sendUpdateLabel',
        },
      }
    },
    view: {
      exit: ['cancelFlowSelection', 'deselectNode', 'deselectHandle'],
      tags: ['view-flow'],
      meta: {
        ...breadcrumbWithParams<FlowsContext>({
          target: 'view',
          getLabel: (ctx) => {
            if (!ctx.selectedFlowId) return '';

            const label = ctx.flowLabels[ctx.selectedFlowId];
            if (label !== undefined && ctx.rootFlowId === ctx.selectedFlowId) return `${label || 'Flow'} (Root)`;
            return label || ctx.selectedFlowId;
          }
        }),
        ...contextMenuFn<FlowsContext>((ctx) => {
          const isRoot = ctx.selectedFlowId === ctx.rootFlowId;
          return [
            { label: 'Edit Label', icon: Edit, event: { type: 'FLOW.REQUEST_EDIT_LABEL' }, iconColor: 'text-primary-400' },
            ...(!isRoot ? [{
              separator: true as const, label: 'Delete Flow', icon: Trash2,
              event: { type: 'FLOW.REQUEST_DELETE' as const }, iconColor: 'text-red-400'
            }] : []),
          ];
        }),
      },
      on: {
        'FLOW.SELECT': { actions: 'selectFlow'},
        'SELECT_ROOT_FLOW': { actions: 'selectFlow' },
        'SELECT_AND_EDIT_FIRST_NODE': { actions: 'selectAndEditFirstNode' },
        'NODE.CLICK': [
          // If handle is selected, connect to clicked node
          {
            guard: 'hasSelectedHandle',
            actions: 'connectFromHandleAndSend',
          },
          // Otherwise, just select the node
          {
            actions: 'selectNode',
          },
        ],
        'NODE.SELECTION_CHANGE': { actions: 'handleSelectionChange' },
        'NODE.DOUBLE_CLICK': { actions: ['cancelFlowSelection', 'editNode'] },
        'NODE.EDITOR.CLOSE': { actions: 'closeNodeEditor' },
        'HANDLE.SELECT': { actions: 'selectHandle' },
        'HANDLE.DESELECT': { actions: 'deselectHandle' },
        'HANDLE.REINDEX': { actions: ['reindexHandles', 'sendReindexHandles'] },
        'NODE.DELETE': { actions: ['deleteNode', 'sendNodeDeleted'] },
        'EDGE.CONNECT': { actions: ['connectEdge', 'sendEdgeConnected'] },
        'EDGE.DISCONNECT': { actions: ['disconnectEdge', 'sendEdgeDisconnected'] },
        'EDGE.RECONNECT': { actions: ['reconnectEdge', 'sendEdgeReconnected'] },
        'NODE.CREATE': {
          actions: 'createNode',
        },
        'NODE.CREATE_CONNECTED': {
          actions: 'createConnectedNode',
        },
        'NODE.UPDATE': {
          actions: ['updateNode', 'sendNodeUpdate'],
        },
        'NODE.UPDATE_POSITION': {
          actions: 'updateNodePosition',
        },
        'FLOW.DELETE': {
          actions: 'sendDeleteFlow',
        },
        'FLOW.UPDATE_LABEL': {
          actions: 'sendUpdateLabel',
        },
        'FLOW.REQUEST_EDIT_LABEL': { actions: 'requestEditLabel' },
        'FLOW.REQUEST_DELETE': { actions: 'requestDeleteFlow' },
        'FLOW.DIALOG_CLOSED': { actions: 'closeDialogs' },
        'GO.BACK': {
          target: 'list',
          actions: assign(({ context }) => ({
            navHistory: pushNavHistory(context.navHistory, null),
          })),
        },
      },
    },
  },
})

export default flowsState
