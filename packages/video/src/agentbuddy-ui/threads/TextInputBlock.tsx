import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {TextInputBlockState} from './threadTypes';
import './TextInputBlock.module.css';

const styles = makeStyles('TextInputBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/TextInput.vue.
export function TextInputBlock({state}: {state: TextInputBlockState}) {
  if (state.disabled && state.response) {
    return (
      <div className={styles.root}>
        <div className={styles.responseHeader}><Icons.Check size={16} /><span>{state.displayText || 'Response submitted'}</span></div>
        <div className={styles.responseValue}>{state.response}</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {state.multiline ? (
        <textarea className={styles.textarea} placeholder={state.placeholder ?? 'Enter text...'} readOnly rows={state.rows ?? 3} value={state.value ?? ''} />
      ) : (
        <input className={styles.input} placeholder={state.placeholder ?? 'Enter text...'} readOnly value={state.value ?? ''} />
      )}
      {state.suggestions?.length ? (
        <div className={styles.suggestions}>{state.suggestions.map(text => <button className={styles.suggestion} key={text} type="button">{text}</button>)}</div>
      ) : null}
      {state.multiline ? (
        <div className={styles.actions}>
          <button className={styles.submit} type="button">Submit</button>
          <button className={styles.cancel} type="button">Cancel</button>
        </div>
      ) : null}
    </div>
  );
}
