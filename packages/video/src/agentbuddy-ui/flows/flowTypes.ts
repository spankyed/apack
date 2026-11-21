export type FlowNodeKind = 'action' | 'create' | 'keep_alive' | 'listener' | 'schedule' | 'llm' | 'flow' | 'switch' | 'fire' | 'kill' | 'entry';

export type FlowPaletteItemState = {
  disabled?: boolean;
  kind: FlowNodeKind;
  label: string;
};

export type FlowNodeState = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  subtitle?: string;
  exits?: string[];
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
  from: string;
  fromExit?: number;
  kind?: 'transitions_to' | 'references' | 'contains';
  to: string;
};

export type FlowCanvasState = {
  canvas?: {
    height: number;
    width: number;
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
