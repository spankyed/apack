import {FlowNode} from '../flows/FlowNode';
import {flowNodeHeight, flowNodeWidth} from '../flows/flowGeometry';
import type {BrainNodeState} from './brainTypes';
import './BrainNode.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('BrainNode');

export function BrainNode({connectedExits, node, selected}: {
  connectedExits?: Set<number>;
  node: BrainNodeState & {x: number; y: number};
  selected?: boolean;
}) {
  const statusStyle = {
    left: `${node.x + flowNodeWidth(node) / 2 - 4}px`,
    top: `${node.y - flowNodeHeight(node) / 2 - 4}px`,
  };

  return (
    <>
      <FlowNode
        connectedExits={connectedExits}
        node={{
          exits: node.exits,
          id: node.id,
          kind: node.kind,
          label: node.label,
          subtitle: node.subtitle ?? node.eventType,
          x: node.x,
          y: node.y,
        }}
        selected={selected}
      />
      {node.status ? <span className={styles.status} data-status={node.status} style={statusStyle} /> : null}
    </>
  );
}
