import type {FlowNodeKind} from '../flows/flowTypes';

export type BrainNodeStatus = 'active' | 'completed' | 'failed' | 'paused' | 'pending';

export type BrainNodeState = {
  children?: BrainNodeState[];
  eventType?: string;
  exits?: string[];
  id: string;
  kind: FlowNodeKind;
  label: string;
  blueprint?: {
    flowId: string;
    nodeId: string;
  };
  completedAt?: string;
  nodeAttributes?: Record<string, unknown>;
  startedAt?: string;
  status?: BrainNodeStatus;
  subtitle?: string;
  x?: number;
  y?: number;
};

export type BrainEventState = {
  active?: boolean;
  eventType: string;
  id: string;
  label: string;
  scope?: string;
  triggerType?: 'listener' | 'schedule';
};

export type BrainSurfaceState = {
  brainIsDead?: boolean;
  brainIsPaused?: boolean;
  canGoBack?: boolean;
  events: BrainEventState[];
  flowTNodeId?: string;
  pulsingEventType?: string;
  selectedNodeId?: string;
  showLeftPanel?: boolean;
  tracks: BrainNodeState[];
};
