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
export interface ModelCatalog {
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

/**
 * What a window asks the flows system, each answered once: the editor applies its own edits at once and holds the
 * flow's view behind its unanswered writes, so every write is an ask. A create answers with what it made, for the
 * window that asked to open or to put in place of the one it drew; the model catalog is asked as the surface starts.
 */
export type FlowsAsks = {
  /** The models the editor offers */
  GET_MODEL_CATALOG: { answer: ModelCatalog }
  /** Answered with the flow made, which only the window that asked opens; its id is minted by the create */
  CREATE_FLOW: { answer: { flowId: EARS.EntityId } }
  DELETE_FLOW: { args: { flowId: string } }
  UPDATE_FLOW_LABEL: { args: { flowId: string; label: string } }
  /** Answered with the node made, for the editor to put in place of the one it added under `tempId` */
  CREATE_NODE: { args: { flowId: string; tempId: string; nodeData: any }; answer: { tempId: string; nodeId: EARS.EntityId; node: NodeEntity } }
  UPDATE_NODE: { args: { flowId: string; nodeId: string; nodeData: any } }
  DELETE_NODE: { args: { flowId: string; nodeId: string } }
  /** Answered with the relation made, for the editor to give the edge it drew */
  CREATE_EDGE: {
    args: { flowId: string; sourceId: string; targetId: string; sourceHandle?: string; targetHandle?: string }
    answer: { sourceId: EARS.EntityId; targetId: EARS.EntityId; relId: EARS.RelationId; sourceHandle?: string; targetHandle?: string }
  }
  DELETE_EDGE: { args: { flowId: string; edgeId: string } }
  UPDATE_EDGE: { args: { flowId: string; edgeId: string; source: string; target: string; sourceHandle?: string; targetHandle?: string } }
  REINDEX_HANDLES: { args: { flowId: string; nodeId: string; prefix: string; index: number; direction: 1 | -1 } }
  /** Makes a flow the root flow the brain runs (its root role), or, with null, leaves no flow the root */
  SET_ROOT_FLOW: { args: { flowId: string | null } }
  /** Answered with the flows it made; refused, with every reference it could not resolve, when one does not */
  IMPORT_DSL: { args: { dsl: any }; answer: { flowIds: EARS.EntityId[] } }
  /** Every flow, or the one named, written to a file in `directory` */
  EXPORT_DSL: { args: { directory: string; flowId?: string }; answer: { filePath: string; flowCount: number; skipped: string[] } }
}

/** The flows system sends no window anything of its own: the flows are its views, and each ask is answered */
export type OutgoingFlowsEvents = never
