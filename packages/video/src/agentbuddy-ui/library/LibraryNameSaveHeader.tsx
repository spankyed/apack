import type {ReactNode} from 'react';
import {Icons} from '../primitives/Icon';
import {LibraryButton} from './LibraryButton';
import {makeStyles} from '../primitives/makeStyles';
import './LibraryNameSaveHeader.module.css';

const styles = makeStyles('LibraryNameSaveHeader');

export function LibraryNameSaveHeader({
  children,
  isEditing,
  isValid = true,
  label = 'Name',
}: {
  children: ReactNode;
  isEditing?: boolean;
  isValid?: boolean;
  label?: string;
}) {
  return (
    <div className={styles.root}>
      <div className={styles.left}>
        <button className={styles.backButton} type="button">
          <Icons.ChevronLeft size={14} />
          <span>Back</span>
        </button>
        <label>{label}</label>
      </div>
      <div className={styles.center}>{children}</div>
      <div className={styles.actions}>
        <LibraryButton disabled={!isValid} variant="primary">
          <span>{isEditing ? 'Save' : 'Create'}</span>
        </LibraryButton>
      </div>
    </div>
  );
}
