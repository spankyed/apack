import {DataRenderer} from '../logs/DataRenderer';
import {Icons} from '../primitives/Icon';
import type {BrainNodeState} from './brainTypes';
import './BrainDetailsPanel.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('BrainDetailsPanel');

export function BrainDetailsPanel({node}: {node?: BrainNodeState}) {
  if (!node) return null;
  const {result, ...input} = node.nodeAttributes ?? {};
  const hasInput = Object.keys(input).length > 0;
  const hasOutput = result !== undefined;
  const hasContent = hasInput || hasOutput;
  const duration = getDuration(node.startedAt, node.completedAt);
  return (
    <aside className={styles.root} data-onboarding-id="brain-step-details">
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.title}>{node.label}</div>
          {node.status ? <span className={styles.status} data-status={node.status}>{node.status}</span> : null}
          {node.stepNodeType ? <span className={styles.kind}>{node.stepNodeType}</span> : null}
          {node.eventType ? <span className={styles.eventType}>{node.eventType}</span> : null}
        </div>
        <button className={styles.closeButton} type="button" aria-label="Close details">
          <Icons.X size={18} />
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.content}>
        {hasInput ? (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>Input Parameters</div>
            <div className={styles.dataBlock}>
              <DataRenderer data={input} />
            </div>
          </section>
        ) : null}
        {hasOutput ? (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>Output Result</div>
            <div className={styles.dataBlock}>
              <DataRenderer data={result} />
            </div>
          </section>
        ) : null}
        {!hasContent && !node.startedAt ? (
          <div className={styles.empty}>{node.status === 'active' ? 'Step is currently executing...' : 'No additional details available'}</div>
        ) : null}
        </div>
      </div>
      {node.blueprint ? (
        <div className={styles.blueprintAction}>
          <button type="button" title="View action details">
            <Icons.ExternalLink size={12} />
            Edit step
          </button>
        </div>
      ) : null}
      {node.startedAt || duration ? (
        <footer className={styles.footer}>
          <div className={styles.sectionTitle}>Execution Info</div>
          <div className={styles.info}>
            {node.startedAt ? <span><span className={styles.label}>Started:</span> {formatTimestamp(node.startedAt)}</span> : null}
            {duration ? <span><span className={styles.label}>Duration:</span> {duration}</span> : null}
          </div>
        </footer>
      ) : null}
    </aside>
  );
}

function getDuration(startedAt?: number, completedAt?: number) {
  if (!startedAt) return null;
  const end = completedAt ?? Date.now();
  const start = startedAt;
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}
