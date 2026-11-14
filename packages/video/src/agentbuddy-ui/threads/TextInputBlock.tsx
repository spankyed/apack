import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import {ActionButtonsBlock} from './ActionButtonsBlock';
import type {TextInputBlockState} from './threadTypes';
import './TextInputBlock.module.css';

const styles = makeStyles('TextInputBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/TextInput.vue.
export function TextInputBlock({state}: {state: TextInputBlockState}) {
  if (state.disabled && state.response) {
    return (
      <div className={styles.root}>
        <div className={styles.responseHeader}><Icons.Check size={16} /><span>{state.displayText || 'Response submitted'}</span></div>
        <div className={styles.responseValue}>{responseText(state.response)}</div>
      </div>
    );
  }

  const suggestions = state.suggestions ?? [];
  const showSuggestions = Boolean(suggestions.length && !state.disabled);
  const canSubmit = Boolean((state.value ?? '').trim());

  return (
    <div className={styles.root}>
      {!state.multiline ? (
        <input className={state.disabled ? styles.inputDisabled : styles.input} disabled={state.disabled} placeholder={state.placeholder ?? 'Enter text...'} readOnly value={state.value ?? ''} />
      ) : null}
      {showSuggestions ? (
        <div className={styles.suggestions}>{suggestions.map(text => <button className={styles.suggestion} key={text} type="button">{text}</button>)}</div>
      ) : state.multiline ? (
        <textarea className={state.disabled ? styles.textareaDisabled : styles.textarea} disabled={state.disabled} placeholder={state.placeholder ?? 'Enter text...'} readOnly rows={state.rows ?? 3} value={state.value ?? ''} />
      ) : null}
      {state.multiline ? (
        <ActionButtonsBlock
          state={{
            buttons: ['submit', 'cancel'],
            submitDisabled: !canSubmit || state.disabled,
          }}
        />
      ) : null}
    </div>
  );
}

function responseText(response: NonNullable<TextInputBlockState['response']>) {
  if (typeof response === 'object') {
    if ('cancelled' in response && response.cancelled === true) return 'Skipped';
    return JSON.stringify(response);
  }
  return String(response);
}
