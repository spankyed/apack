import type {ReactNode} from 'react';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './LibraryButton.module.css';

const styles = makeStyles('LibraryButton');

export function LibraryButton({
  children,
  disabled,
  size = 'md',
  tone,
  variant = 'transparent',
}: {
  children: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  tone?: 'blue' | 'red';
  variant?: 'primary' | 'transparent';
}) {
  return (
    <button className={cx(styles.root, styles[variant], styles[size], tone === 'blue' && styles.blue, tone === 'red' && styles.red)} disabled={disabled} type="button">
      {children}
    </button>
  );
}
