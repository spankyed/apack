import type {CSSProperties} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import './EmptyThreadQuote.module.css';

const styles = makeStyles('EmptyThreadQuote');

// Mirrors the empty-thread quote in packages/renderer/src/plugins/threads/chat/chat.vue.
export function EmptyThreadQuote({style, text}: {style?: CSSProperties; text: string}) {
  return (
    <div className={styles.root} style={style}>
      <p>{text}</p>
    </div>
  );
}
