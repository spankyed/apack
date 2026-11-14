import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestPanelState, PullRequestStatusCheckState} from './codeTypes';
import './PRActionBar.module.css';

const styles = makeStyles('PRActionBar');

export function PRActionBar({mergePressed, state}: {mergePressed?: boolean; state: PullRequestPanelState}) {
  const pr = state.createdPr;
  if (pr && (pr.state === 'MERGED' || pr.state === 'CLOSED')) {
    return (
      <div className={styles.root}>
        <button className={styles.checkout} type="button"><Icons.GitBranch size={11} /><span>Checkout & Pull Base</span></button>
        <span className={styles.spacer} />
        <button className={styles.deleteBranch} type="button"><Icons.Trash2 size={11} /><span>Delete Branch</span></button>
      </div>
    );
  }

  const mergeVariant = getMergeVariant(state);
  const mergeText = mergeVariant === 'pending' ? 'Merge' : mergeVariant === 'merging' ? 'Merge' : 'Merge';
  return (
    <div className={styles.root}>
      <div className={styles.mergeGroup}>
        <button className={styles.merge} data-pressed={mergePressed || undefined} data-variant={mergePressed ? 'merging' : mergeVariant} type="button">
          {mergeIcon(mergeVariant)}
          <span>{mergeText}</span>
        </button>
        <button className={styles.chevron} data-pressed={mergePressed || undefined} data-variant={mergePressed ? 'merging' : mergeVariant} type="button"><Icons.ChevronDown size={11} /></button>
        {state.showMergeTooltip ? <MergeButtonTooltip state={state} variant={mergeVariant} /> : null}
      </div>
      <button className={pr?.isDraft ? styles.ready : styles.draft} type="button">
        <Icons.FileEdit size={11} />
        <span>{pr?.isDraft ? 'Ready' : 'Draft'}</span>
      </button>
      <span className={styles.spacer} />
      <button className={styles.close} type="button"><Icons.CircleX size={11} /><span>Close</span></button>
    </div>
  );
}

type MergeVariant = 'clean' | 'merging' | 'blocked' | 'error' | 'pending';

function getMergeVariant(state: PullRequestPanelState): MergeVariant {
  const pr = state.createdPr;
  if (!pr) return 'blocked';
  if (pr.isDraft) return 'blocked';
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'error';
  if (pr.mergeStateStatus === 'BEHIND') return 'blocked';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'error';
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'blocked';
  if (pr.statusCheckRollup?.some(isFailingCheck)) return 'error';
  if (pr.statusCheckRollup?.some(isPendingCheck)) return 'pending';
  if (pr.mergeStateStatus === 'BLOCKED') return 'blocked';
  if (pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN') return 'pending';
  return 'clean';
}

function mergeIcon(variant: MergeVariant) {
  if (variant === 'pending' || variant === 'merging') return <Icons.Loader2 className={styles.spinner} size={11} />;
  if (variant === 'error') return <Icons.AlertTriangle size={11} />;
  if (variant === 'blocked') return <Icons.CircleX size={11} />;
  return <Icons.GitMerge size={11} />;
}

function MergeButtonTooltip({state, variant}: {state: PullRequestPanelState; variant: MergeVariant}) {
  const pr = state.createdPr;
  const relevantChecks = (pr?.statusCheckRollup ?? []).filter(variant === 'error' ? isFailingCheck : isPendingCheck);
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHeader}>
        {mergeIcon(variant)}
        <div>
          <strong>{tooltipTitle(state, variant)}</strong>
          <span>{tooltipDescription(state, variant)}</span>
        </div>
      </div>
      {relevantChecks.length ? (
        <div className={styles.checks}>
          {relevantChecks.slice(0, 5).map(check => (
            <div className={styles.checkRow} key={check.name}>
              {isPendingCheck(check) ? <Icons.Loader2 className={styles.spinner} size={10} /> : <Icons.CircleX size={10} />}
              <span>{check.name || 'Unnamed check'}</span>
              <em>{checkLabel(check)}</em>
            </div>
          ))}
        </div>
      ) : null}
      {variant === 'blocked' && pr?.isDraft ? <div className={styles.actionHint}>Click Ready to the right to mark as ready for review.</div> : null}
      {pr ? (
        <div className={styles.branchFooter}>
          <Icons.GitBranch size={10} />
          <span>{pr.headBranch ?? state.headBranch}</span>
          <Icons.ArrowRight size={10} />
          <span>{pr.baseBranch ?? state.baseBranch}</span>
        </div>
      ) : null}
    </div>
  );
}

function tooltipTitle(state: PullRequestPanelState, variant: MergeVariant) {
  const pr = state.createdPr;
  if (variant === 'clean') return 'Ready to merge';
  if (variant === 'merging') return 'Merging...';
  if (variant === 'pending') return pr?.mergeable === 'UNKNOWN' || pr?.mergeStateStatus === 'UNKNOWN' ? 'Checking mergeability' : 'Status checks running';
  if (variant === 'error') {
    if (pr?.mergeable === 'CONFLICTING' || pr?.mergeStateStatus === 'DIRTY') return 'Merge conflicts';
    if (pr?.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested';
    return 'Status checks failing';
  }
  if (!pr) return 'No pull request selected';
  if (pr.isDraft) return 'Draft pull request';
  if (pr.mergeStateStatus === 'BEHIND') return 'Branch is out of date';
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'Required review missing';
  if (pr.mergeStateStatus === 'BLOCKED') return 'Blocked by branch protection';
  return 'Cannot merge';
}

function tooltipDescription(state: PullRequestPanelState, variant: MergeVariant) {
  const pr = state.createdPr;
  const base = pr?.baseBranch ?? state.baseBranch;
  if (variant === 'clean') return 'All checks passed and no blockers.';
  if (variant === 'merging') return 'Your merge is in progress.';
  if (variant === 'pending') return pr?.mergeable === 'UNKNOWN' || pr?.mergeStateStatus === 'UNKNOWN'
    ? 'GitHub is computing whether this PR can be merged. Try refreshing in a moment.'
    : 'Waiting for required status checks to complete.';
  if (variant === 'error') {
    if (pr?.mergeable === 'CONFLICTING' || pr?.mergeStateStatus === 'DIRTY') return `This branch has conflicts with ${base}. Resolve them locally and push.`;
    if (pr?.reviewDecision === 'CHANGES_REQUESTED') return 'A reviewer has requested changes. Address them before merging.';
    return 'One or more required status checks have failed.';
  }
  if (!pr) return 'Open a pull request for this branch to enable merging.';
  if (pr.isDraft) return 'Mark this PR as ready for review to enable merge.';
  if (pr.mergeStateStatus === 'BEHIND') return `Update this branch with the latest from ${base} before merging.`;
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'This PR requires an approving review before it can be merged.';
  if (pr.mergeStateStatus === 'BLOCKED') return "This repository's branch protection rules are blocking the merge.";
  return 'This pull request cannot be merged right now.';
}

function isPendingCheck(check: PullRequestStatusCheckState) {
  return check.state === 'PENDING' || check.status === 'QUEUED' || check.status === 'IN_PROGRESS' || check.status === 'PENDING' || check.status === 'REQUESTED';
}

function isFailingCheck(check: PullRequestStatusCheckState) {
  return check.state === 'FAILURE' || check.state === 'ERROR' || check.conclusion === 'FAILURE' || check.conclusion === 'CANCELLED' || check.conclusion === 'TIMED_OUT';
}

function checkLabel(check: PullRequestStatusCheckState) {
  return (check.conclusion || check.status || check.state || '').toLowerCase().replace(/_/g, ' ');
}
