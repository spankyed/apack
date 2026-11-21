import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import './MessageActions.module.css';

const styles = makeStyles('MessageActions');

// Mirrors the floating hover action cluster in packages/renderer/src/plugins/threads/chat/message.vue.
export function MessageActions({
  collapsible,
  createdAt,
  isTail,
  isUser,
  status,
}: {
  collapsible?: boolean;
  createdAt?: string;
  isTail?: boolean;
  isUser?: boolean;
  status?: 'queued' | 'cancelled';
}) {
  const showRevert = Boolean(isUser && (isTail || !status));
  return (
    <div className={styles.root}>
      {createdAt ? <span className={styles.timestamp}>{createdAt}</span> : null}
      {showRevert ? <button type="button" title={status ? 'Revert to input' : 'Revert (right-click for options)'}><Icons.Undo2 size={16} /></button> : null}
      {status === 'queued' ? <button type="button" title="Cancel queued message"><Icons.X size={16} /></button> : null}
      {status === 'cancelled' ? <button type="button" title="Copy message text"><Icons.Copy size={16} /></button> : null}
      {status === 'cancelled' && isTail ? <button type="button" title="Resend message"><Icons.RotateCcw size={16} /></button> : null}
      {!status ? (
        <>
          <button type="button" title="Fork conversation"><Icons.GitFork size={16} /></button>
          {collapsible ? <button type="button" title="Collapse"><Icons.ChevronsUpDown size={16} /></button> : null}
          <button type="button" title="Copy message text"><Icons.Copy size={16} /></button>
        </>
      ) : null}
    </div>
  );
}
