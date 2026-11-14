import {Icons} from '../primitives/Icon';
import {FlowControls} from './FlowControls';
import {FlowEdge} from './FlowEdge';
import {FlowNode} from './FlowNode';
import {FlowPalette} from './FlowPalette';
import type {FlowCanvasState} from './flowTypes';
import type {CSSProperties} from 'react';
import './FlowCanvas.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('FlowCanvas');

// Mirrors packages/renderer/src/plugins/flows/canvas/flow-canvas.vue and components/FlowEditor.vue.
export function FlowCanvas({
  backgroundOpacity = 1,
  hiddenNodeIds,
  state,
}: {
  backgroundOpacity?: number;
  hiddenNodeIds?: ReadonlySet<string>;
  state: FlowCanvasState;
}) {
  const viewport = state.viewport ?? {x: 0, y: 0, zoom: 1};
  const canvas = state.canvas ?? {width: 1120, height: 720};
  const connectedExitsByNode = new Map<string, Set<number>>();
  for (const edge of state.edges) {
    if (edge.fromExit == null) continue;
    const exits = connectedExitsByNode.get(edge.from) ?? new Set<number>();
    exits.add(edge.fromExit);
    connectedExitsByNode.set(edge.from, exits);
  }

  return (
    <div className={styles.root} style={{'--flow-canvas-bg-opacity': backgroundOpacity} as CSSProperties}>
      <FlowPalette items={state.paletteItems} style={state.chrome?.paletteStyle} />
      <section className={styles.editor} data-onboarding-id="flow-editor-canvas">
        <button className={styles.backButton} style={state.chrome?.backButtonStyle} type="button"><Icons.ArrowLeft size={15} />Back</button>
        <div
          className={styles.viewport}
          style={{
            height: `${canvas.height}px`,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            width: `${canvas.width}px`,
          }}
        >
          <svg className={styles.edges} viewBox={`0 0 ${canvas.width} ${canvas.height}`} preserveAspectRatio="none">
            <defs>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={styles.edgeMarker} />
              </marker>
            </defs>
            {state.edges.map((edge, index) => (
              <FlowEdge
                allEdges={state.edges}
                edge={edge}
                key={`${edge.from}-${edge.to}-${index}`}
                nodes={state.nodes}
              />
            ))}
          </svg>
          {state.nodes.map(node => (
            <FlowNode
              connectedExits={connectedExitsByNode.get(node.id)}
              key={node.id}
              editing={state.editingNodeId === node.id}
              node={node}
              selected={state.selectedNodeId === node.id}
              style={hiddenNodeIds?.has(node.id) ? {...node.style, opacity: 0} : node.style}
            />
          ))}
        </div>
        <FlowControls style={state.chrome?.controlsStyle} />
      </section>
    </div>
  );
}
