import type {FlowNodeState} from './flowTypes';

export const FLOW_NODE_GEOMETRY = {
  defaultHeight: 50,
  defaultWidth: 200,
  switch: {
    bottomPadding: 10,
    headerOffset: 43,
    rowHeight: 26,
  },
  trigger: {
    bottomPadding: 10,
    eventTypeHeight: 29,
    headerOffset: 43,
    rowHeight: 22,
  },
} as const;

export function isTriggerNode(node: FlowNodeState) {
  return node.kind === 'entry' || node.kind === 'listener' || node.kind === 'schedule';
}

export function isSwitchNode(node: FlowNodeState) {
  return node.kind === 'switch';
}

export function flowNodeExitCount(node: FlowNodeState) {
  if (isSwitchNode(node)) return node.branches?.length ?? node.exits?.length ?? 0;
  if (isTriggerNode(node)) return (node.exits?.length ?? 0) + 1;
  return node.exits?.length ?? 0;
}

export function flowNodeWidth(node: FlowNodeState) {
  return node.width ?? FLOW_NODE_GEOMETRY.defaultWidth;
}

export function triggerHeaderOffset(node: FlowNodeState) {
  return FLOW_NODE_GEOMETRY.trigger.headerOffset + (node.subtitle ? FLOW_NODE_GEOMETRY.trigger.eventTypeHeight : 0);
}

export function flowNodeHeight(node: FlowNodeState) {
  const exitCount = flowNodeExitCount(node);

  if (isSwitchNode(node)) {
    return Math.max(
      FLOW_NODE_GEOMETRY.defaultHeight,
      FLOW_NODE_GEOMETRY.switch.headerOffset
        + exitCount * FLOW_NODE_GEOMETRY.switch.rowHeight
        + FLOW_NODE_GEOMETRY.switch.bottomPadding,
    );
  }

  if (!isTriggerNode(node) || exitCount <= 1) {
    return FLOW_NODE_GEOMETRY.defaultHeight;
  }

  return Math.max(
    FLOW_NODE_GEOMETRY.defaultHeight,
    triggerHeaderOffset(node)
      + exitCount * FLOW_NODE_GEOMETRY.trigger.rowHeight
      + FLOW_NODE_GEOMETRY.trigger.bottomPadding,
  );
}

export function flowNodePort(node: FlowNodeState, side: 'left' | 'right', exit?: number) {
  const width = flowNodeWidth(node);
  const height = flowNodeHeight(node);
  const left = node.x - width / 2;
  const top = node.y - height / 2;
  const x = side === 'right' ? left + width : left;

  if (side === 'right' && isSwitchNode(node) && typeof exit === 'number') {
    return {
      x,
      y: top + FLOW_NODE_GEOMETRY.switch.headerOffset + (exit + 0.5) * FLOW_NODE_GEOMETRY.switch.rowHeight,
    };
  }

  if (side === 'right' && isTriggerNode(node) && typeof exit === 'number') {
    return {
      x,
      y: top + triggerHeaderOffset(node) + (exit + 0.5) * FLOW_NODE_GEOMETRY.trigger.rowHeight,
    };
  }

  return {x, y: node.y};
}
