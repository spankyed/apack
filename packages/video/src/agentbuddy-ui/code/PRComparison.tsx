import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestFileTreeNode, PullRequestPanelState} from './codeTypes';
import './PRComparison.module.css';

const styles = makeStyles('PRComparison');

export function PRComparison({state}: {state: PullRequestPanelState}) {
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.branchLabel} title={`${state.headBranch} -> ${state.baseBranch}`}>
          <Icons.GitBranch size={12} />
          <span>{state.headBranch}</span>
          <Icons.ArrowRight size={13} />
          <span>{state.baseBranch}</span>
        </div>
        <button type="button" title="Collapse all folders"><Icons.ChevronsDownUp size={14} /></button>
      </header>
      <div className={styles.list}>
        {state.fileTree.map(node => <TreeNode key={node.id} node={node} />)}
      </div>
    </section>
  );
}

function TreeNode({node}: {node: PullRequestFileTreeNode}) {
  if (node.type === 'file') return <TreeFile node={node} />;
  return <TreeFolder node={node} />;
}

function TreeFolder({node}: {node: PullRequestFileTreeNode}) {
  return (
    <div className={styles.folder}>
      <div className={styles.folderRow}>
        <Icons.ChevronDown size={12} />
        <Icons.FolderOpen size={13} />
        <span>{node.label}</span>
        {node.count ? <em>{node.count}</em> : null}
      </div>
      <div className={styles.children}>{node.children?.map(child => <TreeNode key={child.id} node={child} />)}</div>
    </div>
  );
}

function TreeFile({node}: {node: PullRequestFileTreeNode}) {
  return (
    <div className={styles.fileRow}>
      <Icons.File size={13} />
      <span>{node.label}</span>
      {node.status ? <strong>{statusLabel(node.status)}</strong> : null}
      <Icons.Copy size={12} />
    </div>
  );
}

function statusLabel(status: PullRequestFileTreeNode['status']) {
  if (status === 'added') return 'A';
  if (status === 'modified') return 'M';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  return '?';
}
