import type {FlowCanvasState} from '../../agentbuddy-ui/flows/flowTypes';
import {ease} from './timeline';

export type WorkflowShotState = {
  breadcrumbs: string[];
  flow: FlowCanvasState;
};

export type WorkflowShotView = {
  breadcrumbs: string[];
  flow: FlowCanvasState;
};

export const releaseAutomationWorkflow: WorkflowShotState = {
  breadcrumbs: ['Flows', 'Root Flow (Root)'],
  flow: {
    canvas: {width: 1120, height: 720},
    paletteItems: [
      {kind: 'action', label: 'Action'},
      {kind: 'keep_alive', label: 'Keep alive'},
      {kind: 'listener', label: 'Listener'},
      {kind: 'schedule', label: 'Schedule'},
      {kind: 'llm', label: 'LLM', disabled: true},
      {kind: 'flow', label: 'Flow'},
      {kind: 'switch', label: 'Switch'},
      {kind: 'fire', label: 'Fire'},
      {kind: 'kill', label: 'Kill'},
    ],
    nodes: [
      {id: 'entry', kind: 'entry', label: 'Flow Entry', subtitle: 'flow.entry', exits: ['exit 1', 'exit 2', 'exit 3', 'exit 4', 'exit 5'], x: 620, y: 185},
      {id: 'listener', kind: 'flow', label: 'start command listener', x: 900, y: 98},
      {id: 'claude', kind: 'flow', label: 'start claude code work mode', x: 900, y: 232},
      {id: 'keep', kind: 'keep_alive', label: 'Keep Alive', x: 920, y: 355},
      {id: 'codex', kind: 'flow', label: 'Start codex', x: 920, y: 482},
      {id: 'onboarding', kind: 'listener', label: 'Start Onboarding', subtitle: 'tour.complete', exits: ['exit 1', 'exit 2'], x: 615, y: 545},
      {id: 'run', kind: 'flow', label: 'run onboarding', x: 900, y: 640},
    ],
    edges: [
      {from: 'entry', fromExit: 0, kind: 'transitions_to', to: 'listener'},
      {from: 'entry', fromExit: 1, kind: 'transitions_to', to: 'claude'},
      {from: 'entry', fromExit: 2, kind: 'transitions_to', to: 'keep'},
      {from: 'entry', fromExit: 3, kind: 'transitions_to', to: 'codex'},
      {from: 'onboarding', fromExit: 0, kind: 'transitions_to', to: 'run'},
    ],
  },
};

export function workflowStateForFrame(frame: number): FlowCanvasState {
  const flow = releaseAutomationWorkflow.flow;

  return {
    ...flow,
    viewport: workflowViewportForFrame(frame),
  };
}

export function workflowShotViewForFrame(frame: number): WorkflowShotView {
  return {
    breadcrumbs: releaseAutomationWorkflow.breadcrumbs,
    flow: workflowStateForFrame(frame),
  };
}

export function workflowViewportForFrame(frame: number): NonNullable<FlowCanvasState['viewport']> {
  const firstMove = ease(frame, 40, 118);
  const secondMove = ease(frame, 170, 268);
  return {
    x: -28 * firstMove - 46 * secondMove,
    y: 18 * firstMove - 38 * secondMove,
    zoom: 1 + 0.08 * firstMove + 0.08 * secondMove,
  };
}
