import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {ApprovalBlockState, ApprovalOptionState} from './threadTypes';
import './ApprovalBlock.module.css';

const styles = makeStyles('ApprovalBlock');

// Mirrors packages/renderer/src/plugins/threads/chat/interactions/inputs/ApprovalButtons.vue.
export function ApprovalBlock({state}: {state: ApprovalBlockState}) {
  const isDisabled = Boolean(state.disabled || state.requireReason && !state.reason?.trim());

  if (state.disabled && state.response) {
    const approved = isApprovedResponse(state.response);
    const reason = responseReason(state.response);
    const Icon = approved ? Icons.CircleCheck : Icons.CircleX;
    return (
      <div className={styles.root}>
        <div className={approved ? `${styles.response} ${styles.approved}` : `${styles.response} ${styles.denied}`}>
          <Icon size={20} />
          <span>{approved ? 'Approved' : 'Denied'}</span>
        </div>
        {reason ? (
          <div className={styles.reasonBox}>
            <small>Reason:</small>
            {reason}
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
          <textarea className={state.disabled ? styles.textareaDisabled : styles.textarea} disabled={state.disabled} placeholder={state.reasonPlaceholder ?? 'Enter your reason...'} readOnly value={state.reason ?? ''} />
        </div>
      ) : null}
      <div className={styles.actions}>
        {state.autoAcceptOption && !state.options?.length ? (
          <label className={styles.autoAccept}>
            <input className={styles.checkbox} readOnly type="checkbox" />
            <span>Auto-accept file edits for session</span>
          </label>
        ) : null}
        {state.options ? (
          state.options.map(option => <ApprovalButton disabled={isDisabled} key={option.label} option={option} />)
        ) : (
          <div className={styles.defaultActions}>
            <ApprovalButton disabled={isDisabled} icon={Icons.CircleCheck} option={{label: state.approveLabel ?? 'Approve', variant: 'primary'}} />
            <ApprovalButton disabled={isDisabled} icon={Icons.CircleX} option={{label: state.denyLabel ?? 'Deny', variant: 'neutral'}} />
          </div>
        )}
      </div>
    </div>
  );
}

function responseReason(response: ApprovalBlockState['response']) {
  if (response && typeof response === 'object' && 'reason' in response) return response.reason;
  return undefined;
}

function isApprovedResponse(response: ApprovalBlockState['response']) {
  if (response == null) return false;
  if (typeof response === 'boolean') return response;
  if ('approved' in response && response.approved !== undefined) return Boolean(response.approved);
  if ('decision' in response) return response.decision === 'accept' || response.decision === 'acceptForSession';
  return false;
}

function ApprovalButton({disabled, icon: Icon, option}: {disabled?: boolean; icon?: typeof Icons.CircleCheck; option: ApprovalOptionState}) {
  const className = disabled
    ? styles.buttonDisabled
    : option.variant === 'primary'
    ? styles.buttonPrimary
    : option.variant === 'danger'
      ? styles.buttonDanger
      : option.variant === 'secondary'
        ? styles.buttonSecondary
        : styles.button;
  return (
    <button className={className} disabled={disabled} type="button">
      {Icon ? <Icon size={16} /> : null}
      {option.label}
    </button>
  );
}
