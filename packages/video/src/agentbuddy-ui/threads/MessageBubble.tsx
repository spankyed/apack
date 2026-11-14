import type {ReactNode} from 'react';
import {cx} from '../primitives/classNames';
import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {MessageActions} from './MessageActions';
import {MessageAside} from './MessageAside';
import {MessageMarker} from './MessageMarker';
import {MessageReferences, type MessageReferencesState} from './MessageReferences';
import {MessageStatusIndicator} from './MessageStatusIndicator';
import './MessageBubble.module.css';

const styles = makeStyles('MessageBubble');

type MessageBubbleProps = {
  children: ReactNode;
  asUser?: boolean;
  autoHide?: boolean;
  createdAt?: number | string;
  expanded?: boolean;
  forkable?: boolean;
  isCommand?: boolean;
  isTail?: boolean;
  references?: MessageReferencesState;
  sender: 'assistant' | 'marker' | 'system' | 'user';
  status?: 'queued' | 'cancelled';
  truncated?: boolean;
};

// Mirrors packages/renderer/src/plugins/threads/chat/message.vue bubble structure.
export function MessageBubble({asUser, autoHide, children, createdAt, expanded, forkable, isCommand, isTail, references, sender, status, truncated}: MessageBubbleProps) {
  if (sender === 'marker') return <MessageMarker expanded={expanded} text={String(children)} />;
  if (sender === 'system') {
    return (
      <div className={cx(styles.row, styles.assistantRow)}>
        <div className={styles.group}>
          <div className={styles.system}>{children}</div>
        </div>
      </div>
    );
  }
  if (autoHide && !expanded) return <MessageAside asUser={asUser} text={String(children)} />;
  const isCollapsedTruncation = Boolean(truncated && !expanded);
  const canCollapse = Boolean((autoHide && expanded) || (sender === 'user' && truncated && expanded));
  return (
    <div className={cx(styles.row, sender === 'user' ? styles.userRow : styles.assistantRow)}>
      <div className={styles.group}>
        <div className={styles.actions}>
          <MessageActions collapsible={canCollapse} createdAt={createdAt} forkable={forkable} isTail={isTail} isUser={sender === 'user'} status={status} />
        </div>
        <div className={cx(styles.bubble, sender === 'user' ? styles.userBubble : styles.assistantBubble, sender === 'user' && isCommand && styles.commandBubble, status === 'cancelled' && styles.cancelled, isCollapsedTruncation && styles.truncated)}>
          <MessageReferences references={references} />
          <div className={styles.content}>{children}</div>
          {isCollapsedTruncation ? (
            <div className={styles.truncationOverlay}>
              <span><Icons.ChevronDown size={14} />Click to view</span>
            </div>
          ) : null}
        </div>
        {sender === 'user' ? <MessageStatusIndicator status={status} /> : null}
      </div>
    </div>
  );
}
