import {makeStyles} from '../primitives/makeStyles';
import './MessageStatusIndicator.module.css';

const styles = makeStyles('MessageStatusIndicator');

// Mirrors queued/cancelled status text under user messages.
export function MessageStatusIndicator({status}: {status?: 'queued' | 'cancelled'}) {
  if (!status) return null;
  return (
    <div className={styles.root} data-status={status}>
      <span className={styles.dot} />
      <span>{status === 'queued' ? 'Queued' : 'Cancelled'}</span>
    </div>
  );
}
