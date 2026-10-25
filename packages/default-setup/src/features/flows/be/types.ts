import { type NodeEntity } from '#generated/types.ts';
import { EARS } from '#generated/ears.ts';
import type { ModelCatalogEntry } from '@apackdev/sdk/models';
import type { FlowEdge } from '@apackdev/sdk/repositories';

/*─────────────────────────────────────────────────────────────────
 * Flow & Edge entities
 *─────────────────────────────────────────────────────────────────*/

import type { FlowEntity } from '@apackdev/sdk';

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

/** What the flows surface starts from that isn't a row: the models a node may name */
export interface FlowsConnectedData {
  models: ModelCatalogEntry[];
}

/** The flows a window lists, newest first, and which of them the brain runs */
export interface FlowsList {
  flows: Partial<FlowEntity>[];
  rootFlowId?: EARS.EntityId;
}

export interface FlowExtendedData {
  nodes: NodeEntity[];
  edges: EdgeEntity[];
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type FlowsSettings = import('#generated/settings.ts').SettingsOf<'flows'>;

export type IncomingFlowsEvents =
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

/**
 * What the flows system sends: the model catalog when asked to publish, and the answers to a window's writes. The
 * flows themselves are its views.
 */
export type OutgoingFlowsEvents =
  | { type: 'FLOWS_CONNECTED'; data: FlowsConnectedData }
  /**
   * The flow *you* asked to create, answered to the window that asked, which then opens it. Its id is minted by the
   * create, so nothing the asker sent could identify it.
   */
  | { type: 'FLOW_OPENED'; flowId: EARS.EntityId }
  /** The node a `CREATE_NODE` made, for the editor to put in place of the one it added under `tempId` */
  | { type: 'NODE_CREATED'; tempId: string; nodeId: EARS.EntityId; node: NodeEntity }
  /** The relation a `CREATE_EDGE` made, for the editor to give the edge it drew */
  | { type: 'EDGE_CREATED'; sourceId: EARS.EntityId; targetId: EARS.EntityId; relId: EARS.RelationId; sourceHandle?: string; targetHandle?: string }
  /** Any other write landed */
  | { type: 'FLOW_WRITTEN' }
  /** A write was refused, and why: the editor puts back the flow as stored */
  | { type: 'FLOW_WRITE_FAILED'; error: string }
  | { type: 'DSL_IMPORTED'; flowIds: EARS.EntityId[]; errors?: string[] }
  | { type: 'DSL_IMPORT_FAILED'; errors: string[] }
  | { type: 'DSL_EXPORTED'; filePath: string; flowCount: number; skipped: string[] }
  | { type: 'DSL_EXPORT_FAILED'; errors: string[] }
