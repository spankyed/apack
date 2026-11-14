import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {FlowAddHandle} from './FlowAddHandle';
import type {FlowNodeState} from './flowTypes';
import type {CSSProperties} from 'react';
import {flowNodeExitCount, flowNodeWidth, isSwitchNode, isTriggerNode} from './flowGeometry';
import './FlowNode.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('FlowNode');

const iconByKind = {
  action: Icons.Play,
  create: Icons.Plus,
  keep_alive: Icons.Activity,
  listener: Icons.Radio,
  schedule: Icons.Clock,
  llm: Icons.Sparkle,
  flow: Icons.Flows,
  switch: Icons.Split,
  fire: Icons.Zap,
  kill: Icons.Plug,
  entry: Icons.Radio,
  event: Icons.Radio,
};

// Mirrors packages/renderer/src/plugins/flows/canvas/nodes/BaseNode.vue.
export function FlowNode({
  connectedExits,
  editable = true,
  editing,
  node,
  selected,
  style: styleOverride,
}: {
  connectedExits?: Set<number>;
  editable?: boolean;
  editing?: boolean;
  node: FlowNodeState;
  selected?: boolean;
  style?: CSSProperties;
}) {
  const Icon = iconByKind[node.kind];
  const style = {left: `${node.x}px`, top: `${node.y}px`, width: `${flowNodeWidth(node)}px`, ...styleOverride};
  const nodeClassName = cx(styles.node, editing && styles.editing, !editing && selected && styles.selected);
  if (isSwitchNode(node)) {
    const branches: NonNullable<FlowNodeState['branches']> = node.branches ?? node.exits?.map(label => ({label})) ?? [];
    return (
      <div className={cx(nodeClassName, styles.switchNode)} data-kind={node.kind} style={style}>
        <div className={styles.header}><Icon className={styles.nodeIcon} size={14} /><span>{node.label}</span></div>
        {branches.length ? (
          <div className={styles.branchList}>
            {branches.map((branch, index) => (
              <div key={`${branch.label}-${index}`} className={styles.branchRow}>
                <span className={cx(styles.branchIndex, branch.isElse && styles.elseIndex)}>{branch.isElse ? 'E' : index + 1}</span>
                <span className={branch.isElse ? styles.elseLabel : undefined}>{branch.label ?? (branch.isElse ? 'Else' : `Branch ${index + 1}`)}</span>
                {connectedExits?.has(index) ? <span className={styles.handle} /> : editable ? <span className={styles.unconnectedHandle}>+</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (isTriggerNode(node)) {
    const exitCount = flowNodeExitCount(node);
    const exits = Array.from({length: exitCount}, (_, index) => node.exits?.[index] ?? `exit ${index + 1}`);
    return (
      <div className={cx(nodeClassName, styles.entry)} data-kind={node.kind} style={style}>
        <div className={styles.header}><Icon className={styles.nodeIcon} size={14} /><span>{node.label}</span></div>
        {node.subtitle ? <div className={styles.subtitle}>{node.subtitle}</div> : null}
        {exitCount > 1 ? (
          <div className={styles.exitList}>
            {exits.map((exit, index) => (
              <div key={`${exit}-${index}`} className={styles.exitRow}>
                <span className={styles.exitIndex}>{index + 1}</span>
                <span>exit {index + 1}</span>
                {connectedExits?.has(index) ? <span className={styles.handle} /> : editable ? <span className={styles.unconnectedHandle}>+</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={nodeClassName} data-kind={node.kind} style={style}>
      <div className={styles.header}><Icon className={styles.nodeIcon} size={14} /><span>{node.label}</span></div>
      {node.subtitle ? <div className={styles.subtitle}>{node.subtitle}</div> : null}
      {editable ? <FlowAddHandle selected={selected} /> : null}
    </div>
  );
}
