import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {MarkdownBlockState} from './threadTypes';
import {MarkdownViewer} from './MarkdownViewer';
import './MarkdownBlock.module.css';

const styles = makeStyles('MarkdownBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/MarkdownBlock.vue.
export function MarkdownBlock({state}: {state: MarkdownBlockState}) {
  return (
    <div className={styles.root}>
      {state.label ? (
        <div className={styles.header}>
          <span className={styles.label}>{state.label}</span>
          <Icons.Copy size={14} />
        </div>
      ) : null}
      <div className={styles.content}>
        <MarkdownViewer content={state.content} />
      </div>
    </div>
  );
}
