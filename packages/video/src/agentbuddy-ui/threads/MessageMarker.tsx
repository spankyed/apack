import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './MessageMarker.module.css';

const styles = makeStyles('MessageMarker');

// Mirrors the marker branch in packages/renderer/src/plugins/threads/chat/message.vue.
export function MessageMarker({expanded, text}: {expanded?: boolean; text: string}) {
  const Icon = expanded ? Icons.ChevronUp : Icons.ChevronDown;
  return (
    <div className={styles.root}>
      <div className={styles.line} />
      <button className={styles.button} type="button">
        <Icon size={14} />
        <span>{text}</span>
      </button>
      <div className={styles.line} />
    </div>
  );
}
