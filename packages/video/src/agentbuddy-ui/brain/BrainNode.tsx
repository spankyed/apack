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
  const width = flowNodeWidth(node);
  const height = flowNodeHeight(node);
  const statusStyle = {
    left: `${node.x + width / 2 - 6}px`,
    top: `${node.y - height / 2 - 6}px`,
  };
  const showStatus = node.kind !== 'event' && Boolean(node.status);

  return (
    <>
      <FlowNode
        connectedExits={connectedExits}
        editable={false}
        node={{
          id: node.id,
          kind: node.kind,
          label: node.label,
          subtitle: node.subtitle ?? node.eventType,
          x: node.x,
          y: node.y,
        }}
        selected={selected}
      />
      {showStatus ? <span className={styles.status} data-status={node.status} style={statusStyle} /> : null}
    </>
  );
}
