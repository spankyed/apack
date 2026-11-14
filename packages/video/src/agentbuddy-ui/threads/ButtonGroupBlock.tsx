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
        {state.buttons.map(button => {
          const buttonDisabled = disabled || isButtonDisabled(button);
          const variant = buttonVariant(button);
          return (
          <button className={buttonClass(variant, buttonDisabled)} disabled={buttonDisabled} key={button.id} type="button">
            {buttonLabel(button)}
          </button>
          );
        })}
      </div>
    </div>
  );
}

function responseText(state: ButtonGroupBlockState) {
  const response = state.response;
  if (!response) return '';
  const button = state.buttons.find(candidate => candidate.id === response.buttonId);
  if (!button) return response.buttonId;
  return buttonLabel(button, response.state);
}

type ButtonConfig = ButtonGroupBlockState['buttons'][number];
type ButtonVariant = NonNullable<ButtonConfig['variant']>;

function stateConfig(button: ButtonConfig, state = button.state) {
  if (button.toggleStates && state) return button.toggleStates[state as 'on' | 'off'];
  if (button.states && state) return button.states[state];
  return undefined;
}

function buttonLabel(button: ButtonConfig, state = button.state) {
  return stateConfig(button, state)?.label ?? button.label;
}

function buttonVariant(button: ButtonConfig): ButtonVariant {
  return stateConfig(button)?.variant ?? button.variant ?? 'secondary';
}

function isButtonDisabled(button: ButtonConfig) {
  return Boolean(stateConfig(button)?.disabled);
}

function buttonClass(variant: ButtonVariant, disabled?: boolean) {
  const base = styles.button;
  if (disabled) return `${base} ${disabledClass(variant)}`;
  if (variant === 'primary') return `${base} ${styles.primary}`;
  if (variant === 'success') return `${base} ${styles.success}`;
  if (variant === 'danger') return `${base} ${styles.danger}`;
  return `${base} ${styles.secondary}`;
}

function disabledClass(variant: ButtonVariant) {
  if (variant === 'primary') return styles.primaryDisabled;
  if (variant === 'success') return styles.successDisabled;
  if (variant === 'danger') return styles.dangerDisabled;
  return styles.secondaryDisabled;
}
