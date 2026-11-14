import type {FlowCanvasState, FlowsListState} from '../../agentbuddy-ui/flows/flowTypes';
import {launchFilmStory} from './launchStory';
import {ease, mix} from './timeline';

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
    canvas: {width: 1280, height: 720},
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
      {id: 'listener', kind: 'listener', label: 'start command listener', subtitle: 'user.command', exits: ['exit 1'], x: 330, y: 260},
      {id: 'switch', kind: 'switch', label: launchFilmStory.flow.switchLabel, branches: [{label: launchFilmStory.command}, {isElse: true, label: 'Else'}], x: 580, y: 260},
      {id: 'run-migrations', kind: 'action', label: launchFilmStory.flow.actionLabels.migrations, x: 890, y: 210, width: 286},
      {id: 'notify-releases', kind: 'action', label: launchFilmStory.flow.actionLabels.notify, x: 890, y: 340, width: 286},
    ],
    edges: [
      {from: 'listener', fromExit: 0, kind: 'transitions_to', to: 'switch'},
      {from: 'switch', fromExit: 0, kind: 'transitions_to', to: 'run-migrations'},
      {from: 'switch', fromExit: 1, kind: 'transitions_to', to: 'notify-releases'},
    ],
  },
};

export const flowsListState: FlowsListState = {
  rootFlowId: 'root',
  selectedFlowId: launchFilmStory.flow.id,
  focusedFlowId: launchFilmStory.flow.id,
  flows: [
    {id: 'root', label: 'Root Flow', description: 'Default entrypoint for Supafan'},
    {id: launchFilmStory.flow.id, label: launchFilmStory.flow.title, description: 'Checkout feature deploy pipeline'},
    {id: 'post-purchase-flow', label: 'Post-purchase Flow', description: 'Receipt and payout automation'},
    {id: 'creator-onboarding', label: 'Creator Onboarding', description: 'New creator setup wizard'},
    {id: 'daily-digest', label: 'Daily Digest', description: 'Scheduled sales summary'},
  ],
};

export const flowsListSearchState: FlowsListState = {
  ...flowsListState,
  searchMode: true,
  searchQuery: 'release',
};

export const flowsListMenuState: FlowsListState = {
  ...flowsListState,
  menuFlowId: launchFilmStory.flow.id,
};

// Sequential reveal beats (260-frame shot). One focal point at a time:
// listener -> switch -> drawn edge -> canvas/chrome/palette/controls ->
// follow-on actions with drawn edges -> settle.
export const workflowBeats = {
  listener: {from: 0, to: 14},
  switch: {from: 24, to: 56},
  edgeListenerSwitch: {from: 48, to: 76},
  backdrop: {from: 72, to: 104},
  appFrame: {from: 82, to: 116},
  chrome: {from: 96, to: 128},
  palette: {from: 126, to: 156},
  controls: {from: 140, to: 168},
  action1: {from: 168, to: 192},
  edgeAction1: {from: 184, to: 208},
  action2: {from: 204, to: 228},
  edgeAction2: {from: 220, to: 244},
  settle: {from: 244, to: 260},
} as const;

export function workflowStateForFrame(frame: number): FlowCanvasState {
  const flow = releaseAutomationWorkflow.flow;
  const beats = workflowBeats;
  const listenerReveal = ease(frame, beats.listener.from, beats.listener.to);
  const paletteReveal = ease(frame, beats.palette.from, beats.palette.to);
  const canvasControlsReveal = ease(frame, beats.controls.from, beats.controls.to);
  const switchReveal = ease(frame, beats.switch.from, beats.switch.to);
  const action1Reveal = ease(frame, beats.action1.from, beats.action1.to);
  const action2Reveal = ease(frame, beats.action2.from, beats.action2.to);
  const listener = {
    ...flow.nodes[0],
    style: {
      opacity: listenerReveal,
      transform: `translate(-50%, -50%) translateY(${mix(8, 0, listenerReveal)}px) scale(${mix(0.985, 1, listenerReveal)})`,
    },
  };
  const switchNode = {
    ...flow.nodes[1],
    style: {
      opacity: switchReveal,
      transform: `translate(-50%, -50%) translateX(${mix(-64, 0, switchReveal)}px) scale(${mix(0.97, 1, switchReveal)})`,
    },
  };
  const action1Node = {
    ...flow.nodes[2],
    style: {
      opacity: action1Reveal,
      transform: `translate(-50%, -50%) translateX(${mix(-42, 0, action1Reveal)}px) scale(${mix(0.985, 1, action1Reveal)})`,
    },
  };
  const action2Node = {
    ...flow.nodes[3],
    style: {
      opacity: action2Reveal,
      transform: `translate(-50%, -50%) translateX(${mix(-42, 0, action2Reveal)}px) scale(${mix(0.985, 1, action2Reveal)})`,
    },
  };
  const nodes = [
    listener,
    ...(frame >= beats.switch.from ? [switchNode] : []),
    ...(frame >= beats.action1.from ? [action1Node] : []),
    ...(frame >= beats.action2.from ? [action2Node] : []),
  ];
  const edgeDraw = (beat: {from: number; to: number}) => ease(frame, beat.from, beat.to);
  const edges = [
    ...(frame >= beats.edgeListenerSwitch.from ? [{...flow.edges[0], drawProgress: edgeDraw(beats.edgeListenerSwitch)}] : []),
    ...(frame >= beats.edgeAction1.from ? [{...flow.edges[1], drawProgress: edgeDraw(beats.edgeAction1)}] : []),
    ...(frame >= beats.edgeAction2.from ? [{...flow.edges[2], drawProgress: edgeDraw(beats.edgeAction2)}] : []),
  ];
  return {
    ...flow,
    chrome: {
      backButtonStyle: {
        opacity: canvasControlsReveal,
        transform: `translateY(${mix(-6, 0, canvasControlsReveal)}px)`,
      },
      controlsStyle: {
        opacity: canvasControlsReveal,
        transform: `translateY(${mix(8, 0, canvasControlsReveal)}px)`,
      },
      paletteStyle: {
        opacity: paletteReveal,
        transform: `translateX(${mix(-240, 0, paletteReveal)}px)`,
      },
    },
    edges: edges.map(edge => ({...edge, animated: false})),
    nodes,
  };
}

export function workflowShotViewForFrame(frame: number): WorkflowShotView {
  return {
    breadcrumbs: releaseAutomationWorkflow.breadcrumbs,
    flow: workflowStateForFrame(frame),
  };
}
