import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {PullRequestPanelState} from './codeTypes';
import './PRSelector.module.css';

const styles = makeStyles('PRSelector');

export function PRSelector({state}: {state: PullRequestPanelState}) {
  const created = state.createdPr;
  const badge = created ? prBadge(created) : null;
  const openPullRequests = state.openPullRequests ?? [];
  return (
    <div className={styles.root}>
      <button className={styles.button} type="button">
        <Icons.PullRequest className={created ? styles.openIcon : styles.placeholderIcon} size={12} />
        <span className={created ? undefined : styles.placeholder}>
          {created ? `#${created.number} ${state.title}` : 'Select a pull request...'}
        </span>
        {badge ? <span className={styles.state} data-state={badge}>{badge}</span> : null}
      </button>
      {state.selectorOpen ? (
        <div className={styles.dropdown}>
          {openPullRequests.length > 0 ? openPullRequests.map(pr => (
            <button className={styles.dropdownItem} data-selected={created?.number === pr.number ? 'true' : undefined} key={pr.number} type="button">
              <Icons.PullRequest className={styles.statusIcon} data-state={prBadge(pr) ?? 'OPEN'} size={11} />
              <span>#{pr.number} {pr.title}</span>
              {prBadge(pr) ? <span className={styles.state} data-state={prBadge(pr)!}>{prBadge(pr)}</span> : null}
            </button>
          )) : (
            <div className={styles.emptyDropdown}>No open pull requests</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function prBadge(pr: NonNullable<PullRequestPanelState['createdPr']> | NonNullable<PullRequestPanelState['openPullRequests']>[number]) {
  if (pr.state === 'MERGED') return 'MERGED';
  if (pr.state === 'CLOSED') return 'CLOSED';
  if (pr.isDraft || pr.state === 'DRAFT') return 'DRAFT';
  return null;
}
