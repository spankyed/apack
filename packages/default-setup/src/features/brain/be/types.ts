import type { StepRuntimeError } from '@apackdev/sdk/steps';
import type { EARS } from '#generated/ears.ts';

import type { RunStatus, RunTree, RunNode, RunNodeId, ExecutionContext } from '@apackdev/sdk/steps';

export type JsonPath = string;

/** ── Brain-local types ──────────────────────────────────────────────────── */
export interface EventListenerEntity {
  id: EARS.EntityId;
  nodeId: EARS.EntityId;
  eventType: string;
  label: string;
  triggerType: string;
  scope?: 'global' | 'local' | 'entry';
  cronExpression?: string;
}

export interface FlowRunNodeData {
  flowRunNodeId: EARS.EntityId;
  runNodeTree: RunTree[];
  possibleEvents: EventListenerEntity[];
  flowHierarchy: Array<{ flowRunNodeId: EARS.EntityId; label: string }>;
}

/** A run node as the Brain surface shows it: with where its blueprint is, to reveal it in the Flows surface */
export type RunNodeDetails = RunNode & { revealIn?: { flowId: EARS.EntityId; nodeId: EARS.EntityId } };

export interface RunNodeUpdate {
  runNodeId: RunNodeId;
  status: RunStatus;
  eventRunNodeId?: RunNodeId;
}

/** ── Schema definition types ────────────────────────────────────────────── */
export interface FieldSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  description?: string;
  required?: boolean;
  // For objects and arrays
  properties?: Record<string, FieldSchema>;
  items?: FieldSchema;
}

export interface EventSchema {
  eventType: string;
  description?: string;
  fields: Record<string, FieldSchema>;
}

export interface StepOutputSchema {
  stepId: string;
  stepLabel: string;
  description?: string;
  fields: Record<string, FieldSchema>;
}

/** ── Typed context paths (constants unchanged) ──────────────────────────── */
export const ContextPaths = {
  // Event paths
  EVENT_TYPE: '$.event.type' as const,
  EVENT_DATA: '$.event.data' as const,
  EVENT_TIMESTAMP: '$.event.timestamp' as const,

  // Common event data patterns
  EVENT_MESSAGE: '$.event.data.message' as const,
  EVENT_PAYLOAD: '$.event.data.payload' as const,
  EVENT_TEXT: '$.event.data.text' as const,
  EVENT_USER_ID: '$.event.data.userId' as const,

  // Step paths
  LAST_STEP: '$.lastStep' as const,
  LAST_STEP_RESULT: '$.lastStep.result' as const,
  STEPS: '$.steps' as const,

  // Helper functions, returning the same string shapes as the constants above
  stepById: (runNodeId: string): JsonPath => `$.steps[id=${runNodeId}].result`,
  stepByLabel: (label: string): JsonPath => `$.steps[label=${label}].result`,
} as const;

/** ── Field mapping ─────────────────────────────────────────────────────── */
export type SourceResolver = JsonPath | ((ctx: ExecutionContext) => unknown);

export interface FieldMapping {
  target: string;           // Target field in template
  source: SourceResolver;   // JsonPath or resolver function
  default?: unknown;        // Fallback if source is undefined
}

// Brain-private types
export interface EventReceived {
  eventType: string;
  payload?: unknown;
}

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type BrainSettings = import('#generated/settings.ts').SettingsOf<'brain'>;

export type IncomingBrainEvents =
  | { type: 'OPEN_RUN_NODE'; runNodeId: string }
  | { type: 'GO_BACK_RUN_NODE'; currentFlowRunNodeId?: string }
  | { type: 'REQUEST_SURFACE_DATA'; flowRunNodeId?: string }
  | { type: 'GET_RUN_NODE_DETAILS'; runNodeId: string }
  | { type: 'TOGGLE_INSPECT' }
  | { type: 'START_BRAIN' }
  | { type: 'KILL_BRAIN' }
  | { type: 'RESTART_BRAIN' }
  | { type: 'PAUSE_BRAIN' }
  | { type: 'RESUME_BRAIN' }
  | { type: 'HANDLE_BRAIN_EVENT'; eventType: string; payload?: any; targetFlowId?: string }
  | { type: 'TRIGGER_BRAIN_EVENT'; eventType: string; payload?: any; targetFlowId?: string }

// What the brain's own children send it: the flow and step machines it spawns, reporting what they did. Nothing
// outside the feature sends these, so they reach the machine's event union and no dependent pack's facade.
// `HANDLE_BRAIN_EVENT` is not one of them despite being raised here too — the database system sends it
// (`features/database/be/system.ts`), which makes it incoming.
export type BrainInternalEvents =
  | { type: 'RUN_NODE_SPAWNED'; runNode: RunNode; parentId?: EARS.EntityId; eventRunNodeId?: RunNodeId; flowRunNodeId: EARS.EntityId }
  | { type: 'RUN_NODE_UPDATED'; data: RunNodeUpdate }
  | { type: 'CHILD_COMPLETED'; stepId?: EARS.EntityId; runNodeId?: RunNodeId; stepLabel?: string; result?: any; final?: boolean; eventRunNodeId?: RunNodeId; isFlow?: boolean }

/**
 * What the brain system sends the Brain surface. A run's tree and a run node's details are in the run history, which no
 * view can watch, so they are answers to the window that asked (\`REQUEST_SURFACE_DATA\`, \`OPEN_RUN_NODE\`,
 * \`GO_BACK_RUN_NODE\`, \`GET_RUN_NODE_DETAILS\`). The rest is news for every window: the brain's state, an event's
 * pulse, and the run's live feed, which patches the tree a window holds as streaming tokens patch a message.
 */
export type OutgoingBrainEvents =
  | { type: 'RECEIVE_SURFACE_DATA'; data: FlowRunNodeData }
  | { type: 'RUN_NODE_OPENED'; runNodeId: EARS.EntityId; data: FlowRunNodeData }
  | { type: 'RUN_NODE_SPAWNED'; runNode: RunNode; parentId?: EARS.EntityId; eventRunNodeId?: RunNodeId; flowRunNodeId: EARS.EntityId }
  | { type: 'RUN_NODE_UPDATED'; data: RunNodeUpdate }
  | { type: 'EVENT_PULSE'; eventType: string }
  | { type: 'RUN_NODE_DETAILS'; runNodeId: RunNodeId; details: RunNodeDetails | null }
  | { type: 'BRAIN_RUNTIME_ERROR'; error: StepRuntimeError }
  | { type: 'INSPECT_TOGGLED'; enabled: boolean }
  /** The brain stopped; `startError` says why it couldn't start, while it stays stopped for that reason */
  | { type: 'BRAIN_KILLED'; startError?: string }
  /**
   * The brain is running `rootFlowId`, the root flow it started with (a root flow changed since takes a restart), as
   * the run `rootRunId`: each start is a run of its own, a restart of the same root flow included
   */
  | { type: 'BRAIN_STARTED'; rootFlowId: EARS.EntityId; rootRunId: RunNodeId }
  | { type: 'BRAIN_PAUSED' }
  | { type: 'BRAIN_RESUMED' }

export interface BrainContext {
  brainActor?: any;
  eventQueue: Array<{ eventType: string; payload?: any; targetFlowId?: string }>;
  /** Why the brain last failed to start, while it stays stopped for that reason: part of each client's startup data */
  startError?: Error;
  /** Whether the start error was reported (a toast in every open window): once per failed start */
  startErrorReported: boolean;
  /** Whether a client has been seen since this backend started; not current connection presence */
  clientConnected: boolean;
  /** The root flow the running brain started with; undefined while it's stopped */
  runningRootFlowId?: EARS.EntityId;
  /** This session's root run in the run history: a new one each time the brain starts */
  rootRunId?: RunNodeId;
}
