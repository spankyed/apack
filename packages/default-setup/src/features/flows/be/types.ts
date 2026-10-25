import { type NodeEntity } from '#generated/types.ts';
import { EARS } from '#generated/ears.ts';
import type { ModelCatalogEntry } from '@apackdev/sdk/models';
import type { FlowEdge } from '@apackdev/sdk/repositories';

/*─────────────────────────────────────────────────────────────────
 * Flow & Edge entities
 *─────────────────────────────────────────────────────────────────*/

import type { FlowEntity, PromptEntity } from '@apackdev/sdk';

/** A transition between two nodes, as the SDK's flow repository returns it */
export type EdgeEntity = FlowEdge;

/*─────────────────────────────────────────────────────────────────
 * Node entity: generated union of the step node interfaces in each step's types.ts
 *─────────────────────────────────────────────────────────────────*/

export type { NodeEntity } from '#generated/types.ts';

export type NodeKind = NodeEntity['nodeType'] | (string & {});

export type NodeCreateInput = Partial<NodeEntity> & {
  actionId?: string;
  promptTemplateId?: string;
};

/*─────────────────────────────────────────────────────────────────
 * Connected data / UI types
 *─────────────────────────────────────────────────────────────────*/

export interface FlowsConnectedData {
  selectedFlowId: EARS.EntityId;
  graph: {
    nodes: NodeEntity[];
    edges: EdgeEntity[];
  };
  flows: Partial<FlowEntity>[];
  rootFlow?: Partial<FlowEntity>;
  models: ModelCatalogEntry[];
  prompts: PromptEntity[];
  settings?: any;
}

export interface FlowExtendedData {
  nodes: NodeEntity[];
  edges: EdgeEntity[];
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type FlowsSettings = import('#generated/settings.ts').SettingsOf<'flows'>;

export type IncomingFlowsEvents =
  | { type: 'FLOW_SELECT'; flowId: string }
  | { type: 'CREATE_FLOW' }
  | { type: 'DELETE_FLOW'; flowId: string }
  | { type: 'UPDATE_FLOW_LABEL'; flowId: string; label: string }
  | { type: 'CREATE_NODE'; flowId: string; tempId: string; nodeData: any }
  | { type: 'UPDATE_NODE'; flowId: string; nodeId: string; nodeData: any }
  | { type: 'DELETE_NODE'; flowId: string; nodeId: string }
  | { type: 'CREATE_EDGE'; flowId: string; sourceId: string; targetId: string; sourceHandle?: string; targetHandle?: string }
  | { type: 'DELETE_EDGE'; flowId: string; edgeId: string }
  | { type: 'UPDATE_EDGE'; flowId: string; edgeId: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }
  | { type: 'IMPORT_DSL'; dsl: any }
  | { type: 'EXPORT_DSL'; directory: string; flowId?: string }
  | { type: 'REINDEX_HANDLES'; flowId: string; nodeId: string; prefix: string; index: number; direction: 1 | -1 }
  /** Makes a flow the root flow the brain runs (its root role), or, with null, leaves no flow the root */
  | { type: 'SET_ROOT_FLOW'; flowId: string | null }

export type OutgoingFlowsEvents =
  | { type: 'FLOWS_CONNECTED'; data: FlowsConnectedData }
  | { type: 'FLOW_SELECTED'; flowId: EARS.EntityId; data: FlowExtendedData }
  | { type: 'FLOW_REFRESHED'; flowId: EARS.EntityId; data: FlowExtendedData }
  /** A flow exists — news for every window, so every list grows. It opens nothing: see `FLOW_OPENED` */
  | { type: 'FLOW_CREATED'; flow: FlowEntity; flowId: EARS.EntityId; data: { nodes: any[]; edges: any[] } }
  /**
   * The flow *you* asked to create, answered to the window that asked, which then opens it.
   *
   * Its id is minted by the create, so nothing the asker sent could identify it. While the navigation hung
   * off the broadcast above, every open window jumped to a flow it had not created.
   */
  | { type: 'FLOW_OPENED'; flow: FlowEntity; flowId: EARS.EntityId; data: { nodes: any[]; edges: any[] } }
  | { type: 'FLOW_DELETED'; flowId: EARS.EntityId }
  | { type: 'NODE_CREATED'; tempId: string; nodeId: EARS.EntityId; node: any }
  | { type: 'NODE_UPDATED'; nodeId: EARS.EntityId; node: any }
  | { type: 'NODE_DELETED'; nodeId: string }
  | { type: 'EDGE_CREATED'; sourceId: EARS.EntityId; targetId: EARS.EntityId; relId: EARS.RelationId; sourceHandle?: string; targetHandle?: string }
  | { type: 'EDGE_CREATE_FAILED'; sourceId: string; targetId: string; error: string }
  | { type: 'EDGE_DELETED'; edgeId: string }
  | { type: 'EDGE_UPDATED'; edgeId: EARS.RelationId; source: EARS.EntityId; target: EARS.EntityId; sourceHandle?: string; targetHandle?: string }
  | { type: 'EDGE_UPDATE_FAILED'; edgeId: string; error: string }
  | { type: 'DSL_IMPORTED'; flowIds: EARS.EntityId[]; errors?: string[] }
  | { type: 'DSL_IMPORT_FAILED'; errors: string[] }
  | { type: 'DSL_EXPORTED'; filePath: string; flowCount: number; skipped: string[] }
  | { type: 'DSL_EXPORT_FAILED'; errors: string[] }
