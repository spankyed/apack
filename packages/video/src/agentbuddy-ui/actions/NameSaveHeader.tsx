import type {ReactNode} from 'react';
import {Button} from './Button';
import {makeStyles} from '../primitives/makeStyles';
import './NameSaveHeader.module.css';

const styles = makeStyles('ActionsNameSaveHeader');

type NameSaveHeaderProps = {
  actions?: ReactNode;
  children: ReactNode;
  hideSave?: boolean;
  isEditing?: boolean;
  isValid?: boolean;
  label?: string;
};

export function NameSaveHeader({actions, children, hideSave = false, isEditing = false, isValid = true, label = 'Name'}: NameSaveHeaderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.left}>
        <button className={styles.backButton} type="button">
          <svg className={styles.backIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
          <span>Back</span>
        </button>
        <label>{label}</label>
      </div>
      <div className={styles.center}>{children}</div>
      <div className={styles.actions}>
        {actions}
        {!hideSave ? <Button disabled={!isValid}>{isEditing ? 'Save' : 'Create'}</Button> : null}
      </div>
    </div>
  );
}
