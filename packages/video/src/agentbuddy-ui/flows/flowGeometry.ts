import type {FlowNodeState} from './flowTypes';

export const FLOW_NODE_GEOMETRY = {
  defaultHeight: 50,
  defaultWidth: 200,
  trigger: {
    bottomPadding: 10,
    eventTypeHeight: 29,
    headerOffset: 43,
    rowHeight: 22,
  },
} as const;

export function isTriggerNode(node: FlowNodeState) {
  return node.kind === 'entry' || node.kind === 'listener' || node.kind === 'schedule' || Boolean(node.exits?.length);
}

export function flowNodeWidth(node: FlowNodeState) {
  return node.width ?? FLOW_NODE_GEOMETRY.defaultWidth;
}

export function triggerHeaderOffset(node: FlowNodeState) {
  return FLOW_NODE_GEOMETRY.trigger.headerOffset + (node.subtitle ? FLOW_NODE_GEOMETRY.trigger.eventTypeHeight : 0);
}

export function flowNodeHeight(node: FlowNodeState) {
  if (!isTriggerNode(node) || !node.exits?.length || node.exits.length <= 1) {
    return FLOW_NODE_GEOMETRY.defaultHeight;
  }

  return Math.max(
    FLOW_NODE_GEOMETRY.defaultHeight,
    triggerHeaderOffset(node)
      + node.exits.length * FLOW_NODE_GEOMETRY.trigger.rowHeight
      + FLOW_NODE_GEOMETRY.trigger.bottomPadding,
  );
}

export function flowNodePort(node: FlowNodeState, side: 'left' | 'right', exit?: number) {
  const width = flowNodeWidth(node);
  const x = node.x + (side === 'right' ? width / 2 : -width / 2);

  if (side === 'right' && isTriggerNode(node) && typeof exit === 'number') {
    const top = node.y - flowNodeHeight(node) / 2;
    return {
      x,
      y: top + triggerHeaderOffset(node) + (exit + 0.5) * FLOW_NODE_GEOMETRY.trigger.rowHeight,
    };
  }

  return {x, y: node.y};
}
