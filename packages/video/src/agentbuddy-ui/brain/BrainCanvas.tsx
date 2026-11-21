import {Icons} from '../primitives/Icon';
import {flowNodePort} from '../flows/flowGeometry';
import type {FlowEdgeState} from '../flows/flowTypes';
import {BrainNode} from './BrainNode';
import {layoutBrainTracks} from './brainLayout';
import type {BrainNodeState, BrainSurfaceState} from './brainTypes';
import './BrainCanvas.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('BrainCanvas');

function edgePath(a: {x: number; y: number}, b: {x: number; y: number}) {
  const bendX = a.x + Math.min(50, Math.max(20, (b.x - a.x) / 2));
  const radius = Math.min(8, Math.abs(b.y - a.y) / 2.5);
  if (Math.abs(a.y - b.y) < 5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const dir = b.y > a.y ? 1 : -1;
  return `M ${a.x} ${a.y} L ${bendX - radius} ${a.y} Q ${bendX} ${a.y} ${bendX} ${a.y + dir * radius} L ${bendX} ${b.y - dir * radius} Q ${bendX} ${b.y} ${bendX + radius} ${b.y} L ${b.x} ${b.y}`;
}

function buildEdges(nodes: BrainNodeState[]): FlowEdgeState[] {
  const edges: FlowEdgeState[] = [];
  const visit = (node: BrainNodeState) => {
    node.children?.forEach((child, index) => {
      edges.push({animated: node.status === 'active', from: node.id, fromExit: node.exits?.length ? index : undefined, to: child.id});
      visit(child);
    });
  };
  nodes.forEach(visit);
  return edges;
}

export function BrainCanvas({state}: {state: BrainSurfaceState}) {
  const recentTracks = state.tracks.length > 150 ? state.tracks.slice(-150) : state.tracks;
  const nodes = layoutBrainTracks(recentTracks);
  const edges = buildEdges(recentTracks);
  const connectedExitsByNode = new Map<string, Set<number>>();
  for (const edge of edges) {
    if (edge.fromExit == null) continue;
    const exits = connectedExitsByNode.get(edge.from) ?? new Set<number>();
    exits.add(edge.fromExit);
    connectedExitsByNode.set(edge.from, exits);
  }

  return (
    <section className={styles.root} data-onboarding-id="brain-flow-graph">
      <div className={styles.viewport}>
        <svg className={styles.edges}>
          <defs>
            <marker id="brain-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.edgeMarker} />
            </marker>
          </defs>
          {edges.map((edge, index) => {
            const from = nodes.find(node => node.id === edge.from);
            const to = nodes.find(node => node.id === edge.to);
            if (!from || !to) return null;
            const a = flowNodePort(from, 'right', edge.fromExit);
            const b = flowNodePort(to, 'left');
            return <path className={styles.edge} d={edgePath(a, b)} data-active={edge.animated} key={`${edge.from}-${edge.to}-${index}`} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {nodes.map(node => (
          <BrainNode
            connectedExits={connectedExitsByNode.get(node.id)}
            key={node.id}
            node={node}
            selected={state.selectedNodeId === node.id}
          />
        ))}
      </div>
      {state.canGoBack ? <button className={styles.backButton} type="button"><Icons.ArrowLeft size={14} />Back</button> : null}
      <button className={styles.fitButton} title="Jump to latest" type="button"><Icons.Maximize size={16} /></button>
      {state.flowTNodeId ? <div className={styles.currentLabel}>{state.flowTNodeId}</div> : null}
    </section>
  );
}
