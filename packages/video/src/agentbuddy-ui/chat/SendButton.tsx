import {Icons} from '../primitives/Icon';
import './ChatComposer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('ChatComposer');

export function SendButton({disabled, pressed}: {disabled?: boolean; pressed?: boolean}) {
  return (
    <button className={styles.sendButton} data-pressed={pressed || undefined} disabled={disabled} type="submit">
      <span className={styles.responsiveButtonLabel}>Send</span>
      <Icons.CornerDownLeft className={styles.sendIcon} size={16} />
    </button>
  );
}
