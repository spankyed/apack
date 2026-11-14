import {makeStyles} from '../primitives/makeStyles';
import type {PromptBlockState} from './threadTypes';
import './PromptBlock.module.css';

const styles = makeStyles('PromptBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/PromptBlock.vue.
export function PromptBlock({state}: {state: PromptBlockState}) {
  return <div className={styles.root}>{state.content}</div>;
}
