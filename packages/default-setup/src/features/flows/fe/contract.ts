// The flows surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears`. `apack.json` names
// it at `features[].surface.contract`.
import type { NavHistory, SurfaceInbox } from '@apackdev/sdk/fe'
import type { FlowEntity, PromptEntity } from '@apackdev/sdk'
import type { ModelCatalogEntry } from '@apackdev/sdk/models'
import type { EARS } from '#generated/ears.ts'
import type { EdgeEntity, NodeEntity } from '#generated/types.ts'

export interface FlowsContext {
  /** A flow the user asked to open; what the user does next (open another, edit a node, leave) cancels it */
  pendingFlow?: { call: string; flowId: EARS.EntityId; nodeId?: string; recordHistory: boolean };
  /**
   * The shown flow asked for again because the backend published (a reconnect, a pack change, data replaced).
   * Its own slot, so nothing that cancels a user's selection drops it; its answer keeps the node selection, the
   * editor and any node still being added.
   */
  pendingRefresh?: { call: string; flowId: EARS.EntityId };

  selectedNodeId?: EARS.EntityId;
  editingNodeId?: EARS.EntityId; // Node currently being edited
  selectedFlowId?: EARS.EntityId;
  // Handle selection for click-to-connect workflow
  selectedHandle?: {
    nodeId: string;
    handleId?: string;
  };
  graph: {
    nodes: NodeEntity[];
    edges: EdgeEntity[];
    // Store positions separately from node data
    positions: Record<string, { x: number; y: number }>;
  };
  flows: FlowEntity[];
  // Resources available for node configuration
  prompts: PromptEntity[];
  models: ModelCatalogEntry[];
  // Track temporary IDs during async creation
  tempIdMap: Record<string, string>; // tempId -> permanentId
  /** The root flow the brain runs (the flow with the root role), as the flows system last sent it */
  rootFlowId?: string;
  // Settings
  settings?: any; // FlowsSettings
  // Dialog bridge flags (set by context menu, consumed by watchers in flow-canvas.vue)
  showEditLabelDialog?: boolean;
  showDeleteFlowDialog?: boolean;
  canvasError?: string;
  // DSL Import state
  dslImport: {
    status: 'idle' | 'importing' | 'success' | 'error';
    errors: string[];
    importedFlowNames: string[];
  };
  // DSL Export state
  dslExport: {
    status: 'idle' | 'exporting' | 'success' | 'error';
    errors: string[];
    filePath: string;
    flowCount: number;
    /** Flows that could not be written as DSL, having no trigger to hang their steps from */
    skipped: string[];
  };
  navHistory: NavHistory<string | null>;
}

/** What the brain asks of the flows editor: to open a flow, or a node in it */
export type FlowsInboxEvent =
  | { type: 'FLOW.SELECT'; flowId: EARS.EntityId }
  | { type: 'NODE.DOUBLE_CLICK'; nodeId: string }
  | { type: 'NODE.REVEAL'; flowId: EARS.EntityId; nodeId: string }

export type Contract = {
  opens: 'Flow'
  state: FlowsContext
  inbox: SurfaceInbox<{ pack: FlowsInboxEvent }>
}
