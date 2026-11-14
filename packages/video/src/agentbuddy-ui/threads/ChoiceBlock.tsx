import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {ActionButtonsBlock} from './ActionButtonsBlock';
import type {ChoiceBlockState, ChoiceOptionState} from './threadTypes';
import './ChoiceBlock.module.css';

const styles = makeStyles('ChoiceBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ChoiceInput.vue.
export function ChoiceBlock({state}: {state: ChoiceBlockState}) {
  if (state.disabled && state.response) {
    const value = choiceResponseText(state.response);
    return (
      <div className={styles.root}>
        <div className={styles.responseHeader}>
          <Icons.Check size={16} />
          <span>{state.displayText || 'Selected:'}</span>
        </div>
        <div className={styles.responseValue}>{value}</div>
      </div>
    );
  }

  const selectedIds = new Set(state.selectedIds ?? []);
  const canSubmit = selectedIds.size > 0;
  return (
    <div className={styles.root}>
      <div className={state.compact ? styles.choicesCompact : styles.choices}>
        {state.choices.map(choice => <ChoiceOption choice={choice} disabled={state.disabled} key={choice.id} multiSelect={state.multiSelect} selected={selectedIds.has(choice.id)} />)}
      </div>
      {state.skipOption && !state.multiSelect && !state.disabled ? <button className={styles.skip} type="button">{state.skipOption.label}</button> : null}
      {state.allowCustom ? (
        <div className={styles.custom}>
          <label>Or enter custom response:</label>
          <textarea placeholder={state.customPlaceholder ?? 'Type your custom response...'} readOnly rows={1} />
        </div>
      ) : null}
      {state.multiSelect ? (
        <ActionButtonsBlock
          state={{
            buttons: ['submit', 'cancel'],
            cancelLabel: state.skipOption?.label ?? 'Cancel',
            submitDisabled: !canSubmit || state.disabled,
          }}
        />
      ) : null}
    </div>
  );
}

function choiceResponseText(response: NonNullable<ChoiceBlockState['response']>) {
  if (Array.isArray(response)) return response.join(', ');
  if (typeof response === 'object') {
    if (response.cancelled) return 'Skipped';
    return response.value ?? JSON.stringify(response);
  }
  return response;
}

function ChoiceOption({choice, disabled, multiSelect, selected}: {choice: ChoiceOptionState; disabled?: boolean; multiSelect?: boolean; selected?: boolean}) {
  const controlClass = multiSelect
    ? selected ? styles.controlMultiSelected : styles.controlMulti
    : selected ? styles.controlSelected : styles.control;
  return (
    <div className={selected ? styles.selected : disabled ? styles.disabledChoice : styles.choice}>
      <div className={styles.inner}>
        <span className={controlClass}>{selected ? <Icons.Check size={12} /> : null}</span>
        <span className={styles.text}>
          <span className={styles.label}>{choice.label}</span>
          {choice.description ? <span className={styles.description}>{choice.description}</span> : null}
        </span>
      </div>
    </div>
  );
}
