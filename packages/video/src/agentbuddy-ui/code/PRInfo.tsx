import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {PRComments} from './PRComments';
import type {PullRequestPanelState} from './codeTypes';
import './PRInfo.module.css';

const styles = makeStyles('PRInfo');

export function PRInfo({state}: {state: PullRequestPanelState}) {
  const pr = state.createdPr;
  const headBranch = pr?.headBranch ?? state.headBranch;
  const baseBranch = pr?.baseBranch ?? state.baseBranch;
  const badgeState = pr?.isDraft ? 'DRAFT' : pr?.state ?? 'OPEN';
  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.titleBlock}>
            <h3>{state.title}</h3>
            <div className={styles.branchRow}>
              <Icons.GitBranch size={10} />
              <span>{headBranch}</span>
              <Icons.ArrowRight size={10} />
              <span>{baseBranch}</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.number}>#{pr?.number}</span>
            {pr?.state === 'OPEN' ? <button type="button" title="Edit PR"><Icons.Pencil size={14} /></button> : null}
            <button type="button" title="View on GitHub"><Icons.ExternalLink size={14} /></button>
          </div>
        </div>
        <div className={styles.meta}>
          <span className={styles.state} data-state={badgeState}>{statusLabel(pr)}</span>
          {pr?.authorName ? <span>·</span> : null}
          {pr?.authorName ? <span>{pr.authorName}</span> : null}
          {pr?.createdAt ? <span>·</span> : null}
          {pr?.createdAt ? <span>{pr.createdAt}</span> : null}
          <span>·</span>
          <span>{pr?.commitCount ?? state.changedFiles.length} commits</span>
        </div>
      </div>
      <div className={styles.body}>{renderBody(state.body)}</div>
      <PRComments state={state} />
    </section>
  );
}

function statusLabel(pr: PullRequestPanelState['createdPr']) {
  if (!pr) return 'Open';
  if (pr.isDraft || pr.state === 'DRAFT') return 'Draft';
  if (pr.state === 'OPEN') return 'Open';
  return pr.state.charAt(0) + pr.state.slice(1).toLowerCase();
}

function renderBody(body: string) {
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length <= 1) return body;
  return (
    <ul>
      {lines.map(line => <li key={line}>{line.replace(/^[-*]\s*/, '')}</li>)}
    </ul>
  );
}
