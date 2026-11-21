import {makeStyles} from '../primitives/makeStyles';
import './NoteTitleRow.module.css';

const styles = makeStyles('NoteTitleRow');

export function NoteTitleRow({icon, title}: {icon: string; title: string}) {
  return (
    <div className={styles.root}>
      <button className={styles.iconButton} type="button">
        <span className={styles.icon}>{icon}</span>
      </button>
      <input className={styles.input} readOnly value={title} />
    </div>
  );
}
