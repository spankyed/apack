import {Icons} from '../primitives/Icon';
import './CommitMessageBox.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('CommitMessageBox');

export function CommitMessageBox({
  branch,
  commitPressed,
  generatePressed,
  menuActionPressed,
  menuOpen,
  message,
  generating,
}: {
  branch: string;
  commitPressed?: boolean;
  generatePressed?: boolean;
  generating?: boolean;
  menuActionPressed?: boolean;
  menuOpen?: boolean;
  message: string;
}) {
  const canCommit = message.trim().length > 0;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.labelWrap}>
          <div className={styles.moreWrap}>
            <button className={styles.moreButton} data-active={menuOpen || undefined} title="More actions" type="button"><Icons.EllipsisVertical size={14} /></button>
            {menuOpen ? (
              <div className={styles.menu}>
                <button className={styles.menuItem} data-pressed={menuActionPressed || undefined} type="button">
                  Stash All Changes
                </button>
                <button className={styles.menuItem} type="button">
                  Stash Staged Only
                </button>
              </div>
            ) : null}
          </div>
          <span className={styles.label}>{generating ? 'Generating...' : 'Commit Message'}</span>
        </div>
        <button className={styles.generate} data-pressed={generatePressed || undefined} disabled={generating} title="Generate commit message">
          {generating ? <Icons.Loader2 className={styles.spinner} size={14} /> : <Icons.Sparkle size={14} />}
        </button>
      </div>
      <textarea className={styles.textarea} data-generating={generating ? 'true' : undefined} placeholder={`Message (currently on ${branch})`} rows={4} value={message} readOnly />
      <button className={styles.button} data-enabled={canCommit ? 'true' : undefined} data-pressed={commitPressed || undefined} disabled={!canCommit}>Commit</button>
    </div>
  );
}
