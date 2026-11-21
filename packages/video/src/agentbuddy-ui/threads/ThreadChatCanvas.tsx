import type {ReactNode} from 'react';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './ThreadChatCanvas.module.css';

const styles = makeStyles('ThreadChatCanvas');

// Mirrors packages/renderer/src/plugins/threads/chat/chat.vue.
// `align="bottom"` pins the conversation content to the bottom (scrolled-to-
// latest, as a real chat behaves): the newest message — e.g. a queued bubble —
// stays just above the composer while the oldest content overflows off the top,
// instead of the latest content overflowing off the bottom in a static render.
export function ThreadChatCanvas({align = 'top', children}: {align?: 'top' | 'bottom'; children?: ReactNode}) {
  return (
    <div className={styles.root}>
      <div className={styles.messagesWrapper}>
        <div className={styles.messagesScroller}>
          <div className={cx(styles.messagesContent, align === 'bottom' && styles.messagesContentBottom)}>{children}</div>
        </div>
      </div>
    </div>
  );
}
