import {makeStyles} from '../primitives/makeStyles';
import type {ActionButtonsBlockState} from './threadTypes';
import './ActionButtonsBlock.module.css';

const styles = makeStyles('ActionButtonsBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/blocks/ActionButtons.vue.
export function ActionButtonsBlock({state}: {state: ActionButtonsBlockState}) {
  return (
    <div className={styles.root}>
      {state.buttons.includes('submit') ? (
        <button className={submitClass(state.submitVariant, state.submitDisabled)} disabled={state.submitDisabled} type="button">
          {state.submitLabel ?? 'Submit'}
        </button>
      ) : null}
      {state.buttons.includes('cancel') ? (
        <button className={styles.secondary} type="button">
          {state.cancelLabel ?? 'Cancel'}
        </button>
      ) : null}
    </div>
  );
}

function submitClass(variant: ActionButtonsBlockState['submitVariant'] = 'primary', disabled?: boolean) {
  if (disabled) return styles.disabled;
  if (variant === 'success') return styles.success;
  if (variant === 'danger') return styles.danger;
  return styles.primary;
}
