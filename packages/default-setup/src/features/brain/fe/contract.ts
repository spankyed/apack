// The brain surface's contract. It declares no inbox: nothing outside the feature sends it events, and its own
// system's outgoing union already reaches it. What it publishes is its state.
//
// A leaf: no machine, no other feature, and nothing from `#generated/*` but `types` and `ears`.
// `apack.json` names it at `features[].surface.contract`.
import type { EventListenerEntity } from '#generated/types.ts'
import type { StepRuntimeError, RunNode, RunTree } from '@apackdev/sdk/steps'
import type { NormalizedRunNodeTree } from './run-tree.ts'

export interface BrainContext {
  flowRunNodeId?: string;
  runNodeTree?: RunTree[];
  normalizedTree?: NormalizedRunNodeTree;
  possibleEvents: EventListenerEntity[];
  flowHierarchy: Array<{ flowRunNodeId: string; label: string }>;
  pulsingEventType?: string;
  // UI state
  showLeftPanel: boolean;
  selectedStepNode?: RunNode;
  inspectEnabled: boolean;
  animationsEnabled: boolean;
  brainIsDead: boolean;
  /** Why the brain couldn't start, while it stays stopped for that reason */
  startError?: string;
  /** The root flow the running brain started with; the flows surface's root flow differing from it takes a restart */
  runningRootFlowId?: string;
  /** The run of it this window shows: the brain's state names the same run again, and a new start another */
  runningRootRunId?: string;
  brainIsPaused: boolean;
  latestRuntimeError?: StepRuntimeError;
  runtimeErrors: StepRuntimeError[];
  // Settings
  settings?: any; // BrainSettings
}

export type Contract = {
  state: BrainContext
}
