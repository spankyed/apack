/**
 * Step Definition Contracts
 *
 * A step definition bundles everything a step type needs across
 * build (compile/validate/decompile), runtime (handler), and frontend (palette/canvas/form).
 * Packs register step definitions into the StepRegistry so the flows
 * and brain systems dispatch to them instead of hardcoded switches.
 */

/*─────────────────────────────────────────────────────────────────
 * Build-Time Types
 *─────────────────────────────────────────────────────────────────*/

export interface StepCompileContext {
  actions: Map<string, string>;
  prompts: Map<string, string>;
  flows: Map<string, string>;
}

export interface StepRelation {
  source: string;
  kind: string;
  target: string;
  info?: Record<string, unknown>;
}

/**
 * One field a step reads out of the running flow: `target` is where the value lands, `source` is a `$.` path
 * into the execution context or a literal, and `default` is the fallback when the source resolves to nothing.
 *
 * One declaration because there were eight, and they had already drifted: four typed `default` as `any` and
 * three as `unknown`, and four of those reached dependent packs through the published facade. The runtime
 * (`step-input.ts`), the step compilers and the editor forms all describe the same record.
 */
export interface FieldMapping {
  target: string;
  source: string;
  default?: unknown;
}

export interface StepCompileResult {
  entity: Record<string, unknown>;
  relations: StepRelation[];
}

export interface StepValidationError {
  path: string;
  message: string;
}

export interface StepValidationContext {
  actions: Set<string>;
  prompts: Set<string>;
  flowNames: Set<string>;
  nodeLabels: Set<string>;
  path: string;
  skipReferenceCheck?: boolean;
}

export interface StepDecompileContext {
  actionMap: Map<string, string>;
  promptMap: Map<string, string>;
  flowMap: Map<string, string>;
  /** Resolve an inline branch chain from a source node's handle. Returns decompiled DSL steps or null. */
  resolveBranch?: (sourceNodeId: string, sourceHandle: string) => Record<string, unknown>[] | null;
}

export interface StepBranch {
  key: string;
  steps: Record<string, unknown>[];
}

export interface StepBuildFacet {
  compile(node: Record<string, unknown>, nodeId: string, ts: number, ctx: StepCompileContext): StepCompileResult;
  validate(step: Record<string, unknown>, path: string, ctx: StepValidationContext): StepValidationError[];
  getLabel(step: Record<string, unknown>, index: number): string;
  /** Entity → DSL node (reverse of compile). Omit → generic { type, label } fallback. */
  decompile?: (node: Record<string, unknown>, ctx: StepDecompileContext) => Record<string, unknown>;
  /** EARS relation config for this step type. Omit for steps with no entity relations. */
  relation?: { field: string; targetEntity: string };
  /** Return inline branch paths for steps that contain nested step lists. Omit for steps with no branching. */
  branches?: (dslNode: Record<string, unknown>) => StepBranch[];
}

/*─────────────────────────────────────────────────────────────────
 * Brain Runtime Types
 *
 * Shared types for execution context, run nodes, and runtime
 * services. These live in the SDK so step handlers and external
 * packs get real types instead of `unknown` casts.
 *─────────────────────────────────────────────────────────────────*/

import type { EARS } from '../types/entities.ts';
import type { RunNode, RunNodeId } from '../services/run-history.ts';
import type { PackServiceAccess } from '../services/pack-service-access.ts';

export type TimestampMs = number;
/** What a run node ran: a flow, an event it heard, or a step */
export type RunNodeKind = RunNode['kind'];

// Kept here for packs whose built types import it from @apackdev/sdk/steps
export type { SdkEntityShapes } from '../types/sdk-entities.ts';


export interface ExecutionEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: TimestampMs;
  source?: string;
}

export interface StepRun {
  id?: string;
  label: string;
  result: unknown;
  timestamp: TimestampMs;
}

export interface RuntimeServices {
  killFlow: (flowRunNodeId: EARS.EntityId) => void;
  servicesForAction: PackServiceAccess['servicesForAction'];
}

export interface ExecutionContext {
  flowRunNodeId: EARS.EntityId;
  event: ExecutionEvent;
  steps: StepRun[];
  lastStep?: Omit<StepRun, 'timestamp'>;
  runtime: RuntimeServices;
}

/**
 * What a step runs on, whole. Never the run history's record of it: the history keeps a bounded copy for display,
 * and a step running on that copy runs on cut-off strings and truncation markers.
 */
export interface StepInput {
  /** The step's node in the run history, to report against */
  runNodeId: RunNodeId;
  /** The node's settings — a prompt, a model, an event type — with its field mappings applied */
  settings: Record<string, unknown>;
  /** The params it runs on: the node's own, and those mapped from the event and earlier steps */
  params: Record<string, unknown>;
}

export interface StepRuntimeError {
  errorId: string;
  message: string;
  stack?: string;
  source: string;
  phase: string;
  flowRunNodeId?: EARS.EntityId;
  eventRunNodeId?: EARS.EntityId;
  runNodeId?: EARS.EntityId;
  nodeId?: EARS.EntityId;
  nodeLabel?: string;
  nodeType?: string;
  actionId?: EARS.EntityId;
  actionLabel?: string;
  eventType?: string;
  timestamp: TimestampMs;
}

/*─────────────────────────────────────────────────────────────────
 * Runtime Types
 *─────────────────────────────────────────────────────────────────*/

export interface StepRuntimeFacet {
  /**
   * Executes the step.
   *
   * Generic conventions the brain honours from handler results:
   * - **Branching**: `{ sourceHandle: 'branch-N' }` → routes to named branch
   * - **No-match**: `{ noMatch: true }` → terminates the current chain
   * - **Kill**: call `ctx.runtime.killFlow(flowRunNodeId)`
   * - **Keep-alive**: never send COMPLETE → actor stays in executing state
   * - **Final**: set `final: true` on the compiled node → triggers flow completion
   */
  handler?: (input: StepInput, node: unknown, executionContext: ExecutionContext, actor: unknown) => void | Promise<void>;
  isAsync?: boolean;
  /** When true, the brain spawns a sub-flow machine instead of a step machine. */
  spawnsSubflow?: boolean;
  /** The step never completes on its own (keep-alive): its track stays open while the flow runs */
  waits?: boolean;
}

/*─────────────────────────────────────────────────────────────────
 * Node model: what a node of this step type is
 *─────────────────────────────────────────────────────────────────*/

/**
 * What a node of this step type is, as against how it is drawn: how it is labelled and what fields it
 * starts with. Declared inline at `extensions.steps.<type>.node`; codegen carries the same data into both
 * registrations. The backend writes it onto a new entity (`stepRegistry.createNodeDefaults`, reached from
 * `flowRepository.createNode`) and the renderer applies it to the node it draws optimistically.
 */
export interface StepNodeFacet {
  /** The label a new node starts with, and what the canvas shows */
  label: string;
  /** What the palette offers instead of `label` ("Generate text" against "LLM") */
  defaultLabel?: string;
  /** The fields a new node starts with */
  defaults?: Record<string, unknown>;
}

/*─────────────────────────────────────────────────────────────────
 * Frontend Types
 *─────────────────────────────────────────────────────────────────*/

export interface StepNodeConfig {
  icon: unknown;
  connectionRules: { inputs: number; outputs: number };
  category: 'trigger' | 'action' | 'logic' | 'data' | 'ai';
  isImplemented?: boolean;
  isDisabled?: boolean;
}

export interface StepLayoutDescriptor {
  getHeight?: (node: Record<string, unknown>, ctx: { exitCount?: number }) => number;
  getPorts?: (node: Record<string, unknown>, ctx: { exitCount?: number }) => Array<{ id: string; layoutOptions: Record<string, string> }>;
  hasInput?: boolean;
  usesExitCount?: boolean;
}

export interface StepFEFacet {
  nodeConfig: StepNodeConfig;
  colorKey?: string;
  /** Component bindings generated from the declared slots and their loading modes. */
  components?: { node?: unknown; form?: unknown };
  /** Custom ELK layout descriptor (height/ports). Omit → default single-input single-output. */
  layout?: StepLayoutDescriptor;
  /** Handle prefix for multi-output steps (e.g. 'branch' → 'branch-0', 'branch-1'). */
  handlePrefix?: string;
}

/*─────────────────────────────────────────────────────────────────
 * Trigger Types (registered triggers like schedule, webhook, etc.)
 *─────────────────────────────────────────────────────────────────*/

export interface TriggerFacet {
  /** Which DSL track field this trigger type owns (e.g. 'schedule'). Used by compiler to detect trigger type from track. */
  trackField: string;
  /** Compile DSL track into a trigger node entity. */
  compile(track: Record<string, unknown>, trackId: string, ts: number, trackKey: string): Record<string, unknown>;
  /** Decompile trigger node entity back to DSL track fields (e.g. { schedule: '0 * * * *' }). */
  decompile(node: Record<string, unknown>): Record<string, unknown>;
  /** Whether this trigger keeps the flow alive after all tracks drain. */
  persistent?: boolean;
  /** Register trigger-specific runtime hooks (e.g. cron jobs). Called per-node during registerFlowActor. */
  register?(node: TriggerRuntimeNode, ctx: TriggerRuntimeContext): void | Promise<void>;
  /** Additional entity fields needed when querying this trigger's nodes (e.g. ['cronExpression']). */
  queryFields?: string[];
  /** Validate a DSL track before compilation. */
  validateTrack?(track: Record<string, unknown>): { valid: boolean; errors: string[] };
  /** Validate a compiled trigger node entity on persist. */
  validate?(node: Record<string, unknown>): { valid: boolean; errors: string[] };
}

export interface TriggerRuntimeNode {
  id: string;
  label?: string;
  eventType: string;
  trackKey?: string;
  [key: string]: unknown;
}

export interface TriggerRuntimeContext {
  flowRunNodeId: EARS.EntityId;
  /** Fires a flow event at the brain: `tell({ role: 'brain' }, { type: 'TRIGGER_BRAIN_EVENT', eventType, … })` */
  tell: (target: { role: string }, event: { type: string; [key: string]: unknown }, options?: CallOptions) => string;
}

/*─────────────────────────────────────────────────────────────────
 * Step Definition
 *─────────────────────────────────────────────────────────────────*/

export type { StepDSLMeta } from '../framework/declaration-types.ts';
import type { StepDSLMeta } from '../framework/declaration-types.ts';
import type { CallOptions } from '../events/index.ts';

export interface StepDefinition {
  type: string;
  kind?: 'step' | 'trigger';
  /** What a node of this type is. The one facet both registrations carry */
  node?: StepNodeFacet;
  build?: StepBuildFacet;
  runtime?: StepRuntimeFacet;
  fe?: StepFEFacet;
  trigger?: TriggerFacet;
  dsl?: StepDSLMeta;
}
