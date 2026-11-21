import './KeyboardShortcutInput.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('KeyboardShortcutInput');

export function KeyboardShortcutInput({label, value, placeholder = 'Click to set shortcut'}: {
  label?: string;
  placeholder?: string;
  value?: string;
}) {
  return (
    <label className={styles.root}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={styles.box}>
        {value ? <span className={styles.key}>{value}</span> : <span style={{color: 'rgb(82 82 82)'}}>{placeholder}</span>}
      </span>
    </label>
  );
}
