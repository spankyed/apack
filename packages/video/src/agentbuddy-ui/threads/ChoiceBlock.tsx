import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ChoiceBlockState, ChoiceOptionState} from './threadTypes';
import './ChoiceBlock.module.css';

const styles = makeStyles('ChoiceBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ChoiceInput.vue.
export function ChoiceBlock({state}: {state: ChoiceBlockState}) {
  if (state.disabled && state.response) {
    const value = Array.isArray(state.response) ? state.response.join(', ') : state.response;
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
  return (
    <div className={styles.root}>
      <div className={state.compact ? styles.choicesCompact : styles.choices}>
        {state.choices.map(choice => <ChoiceOption choice={choice} key={choice.id} multiSelect={state.multiSelect} selected={selectedIds.has(choice.id)} />)}
      </div>
      {state.skipOption && !state.multiSelect ? <button className={styles.skip} type="button">{state.skipOption.label}</button> : null}
      {state.allowCustom ? (
        <div className={styles.custom}>
          <label>Or enter custom response:</label>
          <textarea placeholder={state.customPlaceholder ?? 'Enter a custom response...'} readOnly rows={1} />
        </div>
      ) : null}
      {state.multiSelect ? (
        <div className={styles.actions}>
          <button className={styles.submit} type="button">Submit</button>
          <button className={styles.cancel} type="button">{state.skipOption?.label ?? 'Cancel'}</button>
        </div>
      ) : null}
    </div>
  );
}

function ChoiceOption({choice, multiSelect, selected}: {choice: ChoiceOptionState; multiSelect?: boolean; selected?: boolean}) {
  const controlClass = multiSelect
    ? selected ? styles.controlMultiSelected : styles.controlMulti
    : selected ? styles.controlSelected : styles.control;
  return (
    <div className={selected ? styles.selected : styles.choice}>
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
