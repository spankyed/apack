import type {CSSProperties} from 'react';

export type FlowNodeKind = 'action' | 'create' | 'keep_alive' | 'listener' | 'schedule' | 'llm' | 'flow' | 'switch' | 'fire' | 'kill' | 'entry' | 'event';

export type FlowPaletteItemState = {
  disabled?: boolean;
  kind: FlowNodeKind;
  label: string;
  pressed?: boolean;
};

export type FlowListItemState = {
  description?: string;
  id: string;
  label?: string;
};

export type FlowsListState = {
  focusedFlowId?: string;
  flows: FlowListItemState[];
  menuFlowId?: string;
  multiSelectedFlowIds?: string[];
  rootFlowId?: string;
  searchMode?: boolean;
  searchQuery?: string;
  selectedFlowId?: string;
};

export type FlowNodeState = {
  branches?: Array<{isElse?: boolean; label?: string}>;
  id: string;
  kind: FlowNodeKind;
  label: string;
  subtitle?: string;
  exits?: string[];
  style?: CSSProperties;
  width?: number;
  x: number;
  y: number;
};

export type FlowNodeFormFieldState = {
  checked?: boolean;
  description?: string;
  filePath?: string;
  height?: number;
  label: string;
  language?: string;
  options?: Array<{label: string; selected?: boolean}>;
  required?: boolean;
  type?: 'input' | 'select' | 'textarea' | 'code' | 'segmented' | 'checkbox';
  value?: string;
};

export type FlowNodeFormSectionState = {
  action?: {
    icon?: 'code' | 'external' | 'plus' | 'trash';
    label: string;
  };
  fields?: FlowNodeFormFieldState[];
  items?: Array<{
    badge?: string;
    description?: string;
    fields?: FlowNodeFormFieldState[];
    label: string;
    tone?: 'neutral' | 'warning';
  }>;
  title: string;
};

export type FlowNodeFormState = {
  canAddNextStep?: boolean;
  nodeKind: FlowNodeKind;
  nodeLabel: string;
  sections: FlowNodeFormSectionState[];
};

export type FlowEdgeState = {
  animated?: boolean;
  // 0..1 draw-in progress for film reveals; undefined renders the full edge.
  drawProgress?: number;
  from: string;
  fromExit?: number;
  kind?: 'transitions_to' | 'references' | 'contains';
  selected?: boolean;
  to: string;
};

export type FlowCanvasState = {
  canvas?: {
    height: number;
    width: number;
  };
  chrome?: {
    backButtonStyle?: CSSProperties;
    controlsStyle?: CSSProperties;
    paletteStyle?: CSSProperties;
  };
  editingNodeId?: string;
  edges: FlowEdgeState[];
  nodes: FlowNodeState[];
  paletteItems: FlowPaletteItemState[];
  selectedNodeId?: string;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};
