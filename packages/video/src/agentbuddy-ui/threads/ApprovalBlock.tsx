import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ApprovalBlockState, ApprovalOptionState} from './threadTypes';
import './ApprovalBlock.module.css';

const styles = makeStyles('ApprovalBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ApprovalButtons.vue.
export function ApprovalBlock({state}: {state: ApprovalBlockState}) {
  if (state.disabled && state.response) {
    const approved = state.response.approved;
    const Icon = approved ? Icons.CircleCheck : Icons.AlertCircle;
    return (
      <div className={styles.root}>
        <div className={approved ? `${styles.response} ${styles.approved}` : `${styles.response} ${styles.denied}`}>
          <Icon size={20} />
          <span>{approved ? 'Approved' : 'Denied'}</span>
        </div>
        {state.response.reason ? (
          <div className={styles.reasonBox}>
            <small>Reason:</small>
            {state.response.reason}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {state.requireReason || state.allowReason ? (
        <div className={styles.reason}>
          <label>Reason {state.requireReason ? '(required)' : '(optional)'}:</label>
          <textarea className={styles.textarea} placeholder={state.reasonPlaceholder ?? 'Enter your reason...'} readOnly value={state.reason ?? ''} />
        </div>
      ) : null}
      <div className={styles.actions}>
        {state.autoAcceptOption ? (
          <label className={styles.autoAccept}>
            <span className={styles.checkbox} />
            <span>Auto-accept file edits for session</span>
          </label>
        ) : null}
        {(state.options ?? defaultOptions(state)).map(option => <ApprovalButton key={option.label} option={option} />)}
      </div>
    </div>
  );
}

function ApprovalButton({option}: {option: ApprovalOptionState}) {
  const className = option.variant === 'primary'
    ? styles.buttonPrimary
    : option.variant === 'danger'
      ? styles.buttonDanger
      : option.variant === 'secondary'
        ? styles.buttonSecondary
        : styles.button;
  return <button className={className} type="button">{option.label}</button>;
}

function defaultOptions(state: ApprovalBlockState): ApprovalOptionState[] {
  return [
    {label: state.approveLabel ?? 'Approve', variant: 'primary'},
    {label: state.denyLabel ?? 'Deny', variant: 'neutral'},
  ];
}
