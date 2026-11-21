import {cx} from '../primitives/classNames';
import type {FlowEdgeState, FlowNodeState} from './flowTypes';
import {flowNodePort} from './flowGeometry';
import './FlowCanvas.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('FlowCanvas');

// Mirrors packages/renderer/src/plugins/flows/canvas/edges/GenericEdge.vue.
function elbowPath(a: {x: number; y: number}, b: {x: number; y: number}, hasSiblings: boolean) {
  const straightThreshold = 5;
  const maxBendOffset = 50;
  const cornerRadius = 8;
  const vDist = Math.abs(b.y - a.y);
  if (vDist < straightThreshold && !hasSiblings) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  const hDist = Math.max(0, b.x - a.x);
  const bendX = a.x + Math.min(maxBendOffset, hDist / 2);
  const radius = Math.min(cornerRadius, vDist / 2.5, Math.max(1, hDist / 4));
  const dir = b.y > a.y ? 1 : -1;

  return [
    `M ${a.x} ${a.y}`,
    `L ${bendX - radius} ${a.y}`,
    `Q ${bendX} ${a.y} ${bendX} ${a.y + dir * radius}`,
    `L ${bendX} ${b.y - dir * radius}`,
    `Q ${bendX} ${b.y} ${bendX + radius} ${b.y}`,
    `L ${b.x} ${b.y}`,
  ].join(' ');
}

export function FlowEdge({
  allEdges,
  edge,
  nodes,
}: {
  allEdges: FlowEdgeState[];
  edge: FlowEdgeState;
  nodes: FlowNodeState[];
}) {
  const from = nodes.find(node => node.id === edge.from);
  const to = nodes.find(node => node.id === edge.to);
  if (!from || !to) return null;
  const a = flowNodePort(from, 'right', edge.fromExit);
  const b = flowNodePort(to, 'left');
  const hasSiblings = allEdges.filter(sibling => sibling.to === edge.to).length >= 2;
  const isAnimated = edge.animated === true;
  const path = elbowPath(a, b, hasSiblings);
  return (
    <g>
      <path className={styles.edgeHitArea} d={path} vectorEffect="non-scaling-stroke" />
      <path
        className={cx(styles.edge, isAnimated && styles.animatedEdge)}
        d={path}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
