import {Icons} from '../primitives/Icon';
import {LibraryButton} from './LibraryButton';
import './BrokenSymlinkView.module.css';
import {makeStyles} from '../primitives/makeStyles';

const styles = makeStyles('BrokenSymlinkView');

type BrokenSymlinkViewProps = {
  lastKnownPath?: string | null;
};

// Mirrors packages/renderer/src/plugins/library/components/BrokenSymlinkView.vue.
export function BrokenSymlinkView({lastKnownPath}: BrokenSymlinkViewProps) {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.iconWrap}>
            <Icons.Link2Off size={16} />
          </div>
          <div className={styles.headerCopy}>
            <h3>Linked folder is no longer accessible</h3>
            <p>The target may have been renamed, moved, or deleted.</p>
          </div>
        </div>

        {lastKnownPath ? (
          <div className={styles.pathBox}>
            <p>Last known path</p>
            <code>{lastKnownPath}</code>
          </div>
        ) : null}

        <div className={styles.relink}>
          <div className={styles.inputRow}>
            <input className={styles.input} placeholder="Enter directory path" readOnly type="text" value="" />
            <LibraryButton size="sm" variant="transparent">Browse</LibraryButton>
          </div>
          <div className={styles.actions}>
            <button className={styles.remove} type="button">Remove link</button>
            <LibraryButton disabled size="sm" variant="primary">Re-link</LibraryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
