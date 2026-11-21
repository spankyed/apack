import type {ReactNode} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import './ThreadChatCanvas.module.css';

const styles = makeStyles('ThreadChatCanvas');

// Mirrors packages/renderer/src/plugins/threads/chat/chat.vue.
export function ThreadChatCanvas({children}: {children: ReactNode}) {
  return (
    <div className={styles.root}>
      <div className={styles.messagesWrapper}>
        <div className={styles.messagesScroller}>
          <div className={styles.messagesContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}

