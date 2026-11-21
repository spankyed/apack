import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ButtonGroupBlockState} from './threadTypes';
import './ButtonGroupBlock.module.css';

const styles = makeStyles('ButtonGroupBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ButtonGroupInput.vue.
export function ButtonGroupBlock({state}: {state: ButtonGroupBlockState}) {
  const disabled = state.disabled && !state.keepInteractive;
  if (disabled && state.response) {
    return (
      <div className={styles.root}>
        <div className={styles.responseHeader}>
          <Icons.Check size={16} />
          <span>{state.displayText ?? 'Button pressed'}</span>
        </div>
        <div className={styles.responseValue}>{responseText(state)}</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.buttons}>
        {state.buttons.map(button => (
          <button className={buttonClass(button.variant ?? 'secondary', disabled)} disabled={disabled} key={button.id} type="button">
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function responseText(state: ButtonGroupBlockState) {
  const response = state.response;
  if (!response) return '';
  const button = state.buttons.find(candidate => candidate.id === response.buttonId);
  return button?.label ?? response.buttonId;
}

function buttonClass(variant: NonNullable<ButtonGroupBlockState['buttons'][number]['variant']>, disabled?: boolean) {
  const base = styles.button;
  if (disabled) return `${base} ${styles.disabled}`;
  if (variant === 'primary') return `${base} ${styles.primary}`;
  if (variant === 'success') return `${base} ${styles.success}`;
  if (variant === 'danger') return `${base} ${styles.danger}`;
  return `${base} ${styles.secondary}`;
}
