import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './PRActionBar.module.css';

const styles = makeStyles('PRActionBar');

export function PRActionBar() {
  return (
    <div className={styles.root}>
      <div className={styles.mergeGroup}>
        <button className={styles.merge} type="button"><Icons.GitMerge size={11} /><span>Merge</span></button>
        <button className={styles.chevron} type="button"><Icons.ChevronDown size={11} /></button>
      </div>
      <button className={styles.draft} type="button"><Icons.FileEdit size={11} /><span>Draft</span></button>
      <span className={styles.spacer} />
      <button className={styles.close} type="button"><Icons.X size={11} /><span>Close</span></button>
    </div>
  );
}
