import {makeStyles} from '../primitives/makeStyles';
import type {NoteBlockState} from './threadTypes';
import './NoteBlock.module.css';

const styles = makeStyles('NoteBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/NoteBlock.vue.
export function NoteBlock({state}: {state: NoteBlockState}) {
  const variant = state.variant ?? 'info';
  return (
    <div className={`${styles.root} ${styles[variant]}`}>
      <div className={styles.label}>{state.label ?? 'Note'}</div>
      <div className={styles.content}>{state.content}</div>
    </div>
  );
}
