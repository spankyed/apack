import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {MarkdownBlockState} from './threadTypes';
import {MarkdownViewer} from './MarkdownViewer';
import './MarkdownBlock.module.css';

const styles = makeStyles('MarkdownBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/MarkdownBlock.vue.
export function MarkdownBlock({state}: {state: MarkdownBlockState}) {
  const hasOverflow = state.content.length > 520;

  return (
    <div className={styles.root}>
      {state.label ? (
        <div className={styles.header}>
          <span className={styles.label}>{state.label}</span>
          <button className={styles.copyButton} title="Copy to clipboard" type="button"><Icons.Copy size={14} /></button>
        </div>
      ) : null}
      <div className={styles.content}>
        <MarkdownViewer content={state.content} />
        {hasOverflow ? <div className={styles.scrollbar}><span /></div> : null}
      </div>
    </div>
  );
}
