import type {ReactNode} from 'react';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './LibraryButton.module.css';

const styles = makeStyles('LibraryButton');

export function LibraryButton({
  children,
  disabled,
  size = 'md',
  variant = 'transparent',
}: {
  children: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'transparent';
}) {
  return (
    <button className={cx(styles.root, styles[variant], styles[size])} disabled={disabled} type="button">
      {children}
    </button>
  );
}
