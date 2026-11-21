import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestFileTreeNode, PullRequestPanelState} from './codeTypes';
import './PRComparison.module.css';

const styles = makeStyles('PRComparison');

export function PRComparison({state}: {state: PullRequestPanelState}) {
  if (state.loadingFiles && state.fileTree.length === 0) return <FileTreeSkeleton />;
  if (state.fileTree.length === 0) {
    return (
      <section className={styles.root}>
        <div className={styles.emptyState}>
          <Icons.GitBranch size={40} />
          <h3>No changes found</h3>
          <p>Comparing with {state.baseBranch || 'base branch'}</p>
        </div>
      </section>
    );
  }

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

function FileTreeSkeleton() {
  const rows = [
    {key: 'f1', isFolder: true, padLeft: 16, width: 72},
    {key: 'a1', isFolder: false, padLeft: 36, width: 96},
    {key: 'a2', isFolder: false, padLeft: 36, width: 64},
    {key: 'f2', isFolder: true, padLeft: 16, width: 88},
    {key: 'b1', isFolder: false, padLeft: 36, width: 108},
    {key: 'b2', isFolder: false, padLeft: 36, width: 76},
    {key: 'c1', isFolder: false, padLeft: 36, width: 84},
  ];

  return (
    <section className={styles.root}>
      <header className={styles.skeletonHeader}>
        <span className={styles.skeletonIcon} />
        <span className={styles.skeletonText} style={{width: 56}} />
        <span className={styles.skeletonSmall} />
        <span className={styles.skeletonText} style={{width: 40, opacity: 0.65}} />
      </header>
      <div className={styles.skeletonList}>
        {rows.map(row => (
          <div className={styles.skeletonRow} key={row.key} style={{paddingLeft: row.padLeft}}>
            {row.isFolder ? (
              <>
                <span className={styles.skeletonChevron} />
                <span className={styles.skeletonFolder} />
              </>
            ) : (
              <span className={styles.skeletonFile} />
            )}
            <span className={styles.skeletonText} style={{width: row.width}} />
          </div>
        ))}
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
        <Icons.ChevronRight className={styles.chevron} size={12} />
        <Icons.Folder size={16} />
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
      <Icons.FileCode size={16} />
      <span>{node.label}</span>
      {node.status ? <strong data-status={node.status}>{statusLabel(node.status)}</strong> : null}
      <Icons.File size={12} />
    </div>
  );
}

function statusLabel(status: PullRequestFileTreeNode['status']) {
  if (status === 'added') return 'A';
  if (status === 'modified') return 'M';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  if (status === 'copied') return 'C';
  if (status === 'typechange') return 'T';
  return 'U';
}
