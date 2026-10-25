// The flows surface's contract: the state it publishes and what other surfaces may send it.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears`. `apack.json` names
// it at `features[].surface.contract`.
import type { NavHistory, SurfaceInbox } from '@apackdev/sdk/fe'
import type { ModelCatalogEntry } from '@apackdev/sdk/models'
import type { EARS } from '#generated/ears.ts'
import type { EdgeEntity, NodeEntity } from '#generated/types.ts'

export interface FlowsContext {
  /** A flow the user asked to open, until its graph's view reads it; what the user does next cancels it */
  pendingFlow?: { flowId: EARS.EntityId; nodeId?: string; recordHistory: boolean };

  selectedNodeId?: EARS.EntityId;
  editingNodeId?: EARS.EntityId; // Node currently being edited
  selectedFlowId?: EARS.EntityId;
  // Handle selection for click-to-connect workflow
  selectedHandle?: {
    nodeId: string;
    handleId?: string;
  };
  /**
   * The open flow as the editor shows it: its graph view's last result, with the user's edits applied at once on top
   * of it. Positions are the editor's own layout, never stored.
   */
  graph: {
    nodes: NodeEntity[];
    edges: EdgeEntity[];
    positions: Record<string, { x: number; y: number }>;
  };
  /**
   * The editor's graph writes still unanswered, by call. While any is, a result of the graph's view is held rather
   * than applied, since it may predate the write and would undo an edit on screen; once the last is answered, a held
   * result — or a refused write — reads the view again (`graphRefresh`), which by then holds every answered write.
   */
  pendingWrites: Record<string, true>;
  /** Whether a result of the graph's view arrived while writes were unanswered, or one of them was refused */
  graphStale: boolean;
  /** Counts the times the editor asked to read the graph's view again; the canvas re-reads on each */
  graphRefresh: number;
  /** The models a node may name, which the flows system sends when it publishes */
  models: ModelCatalogEntry[];
  // Track temporary IDs during async creation
  tempIdMap: Record<string, string>; // tempId -> permanentId
  /** The root flow the brain runs and each flow's label, from the list view: what the breadcrumb and history read */
  rootFlowId?: EARS.EntityId;
  flowLabels: Record<string, string>;
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
