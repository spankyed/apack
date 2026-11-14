import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestPanelState} from './codeTypes';
import './PRSelector.module.css';

const styles = makeStyles('PRSelector');

export function PRSelector({state}: {state: PullRequestPanelState}) {
  const created = state.createdPr;
  const badge = created ? prBadge(created) : null;
  return (
    <div className={styles.root}>
      <button className={styles.button} type="button">
        <Icons.PullRequest size={12} />
        <span className={created ? undefined : styles.placeholder}>
          {created ? `#${created.number} ${state.title}` : 'Select a pull request...'}
        </span>
        {badge ? <span className={styles.state} data-state={badge}>{badge}</span> : null}
      </button>
    </div>
  );
}

function prBadge(pr: NonNullable<PullRequestPanelState['createdPr']>) {
  if (pr.state === 'MERGED') return 'MERGED';
  if (pr.state === 'CLOSED') return 'CLOSED';
  if (pr.isDraft || pr.state === 'DRAFT') return 'DRAFT';
  return null;
}
