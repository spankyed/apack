import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ChoiceOptionState, QuestionBlockState} from './threadTypes';
import './QuestionBlock.module.css';

const styles = makeStyles('QuestionBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/QuestionInput.vue.
export function QuestionBlock({state}: {state: QuestionBlockState}) {
  if (state.disabled && state.response) {
    return (
      <div className={styles.root}>
        <div className={styles.responseHeader}><Icons.Check size={16} /><span>Answered</span></div>
        <div className={styles.responseValue}>{responseText(state.response)}</div>
      </div>
    );
  }

  const currentStep = state.currentStep ?? 0;
  const currentQuestion = state.questions[currentStep] ?? state.questions[0];
  const selectedIds = new Set(state.selectedIds ?? []);
  const isWizard = state.questions.length > 1;
  const isLast = currentStep >= state.questions.length - 1;

  return (
    <div className={styles.root}>
      {isWizard ? (
        <div className={styles.steps}>
          {state.questions.map((_, index) => <span className={stepClass(index, currentStep)} key={index} />)}
          <span className={styles.stepText}>{currentStep + 1} / {state.questions.length}</span>
        </div>
      ) : null}
      <div className={styles.question}>{currentQuestion.question}</div>
      <div className={styles.choices}>
        {currentQuestion.options.map(option => (
          <QuestionChoice key={option.id} multiSelect={currentQuestion.multiSelect} option={option} selected={selectedIds.has(option.id)} />
        ))}
      </div>
      {currentQuestion.allowCustom !== false ? (
        <div className={styles.custom}>
          <label>Or enter custom response:</label>
          <textarea placeholder={state.customPlaceholder ?? 'Enter a response...'} readOnly rows={1} />
        </div>
      ) : null}
      <div className={styles.actions}>
        {isWizard && currentStep > 0 ? <button className={styles.back} type="button">Back</button> : null}
        <button className={styles.cancel} type="button">Cancel</button>
        <button className={styles.submit} type="button">{isLast ? 'Submit' : 'Next'}</button>
      </div>
    </div>
  );
}

function QuestionChoice({multiSelect, option, selected}: {multiSelect?: boolean; option: ChoiceOptionState; selected?: boolean}) {
  const controlClass = multiSelect
    ? selected ? styles.controlMultiSelected : styles.controlMulti
    : selected ? styles.controlSelected : styles.control;
  return (
    <div className={selected ? styles.selected : styles.choice}>
      <div className={styles.choiceInner}>
        <span className={controlClass}>{selected ? <Icons.Check size={12} /> : null}</span>
        <span>
          <div className={styles.label}>{option.label}</div>
          {option.description ? <div className={styles.description}>{option.description}</div> : null}
        </span>
      </div>
    </div>
  );
}

function stepClass(index: number, currentStep: number) {
  if (index < currentStep) return styles.stepDone;
  if (index === currentStep) return styles.stepCurrent;
  return styles.step;
}

function responseText(response: NonNullable<QuestionBlockState['response']>) {
  if (typeof response === 'string') return response;
  return Object.values(response).join(', ');
}
