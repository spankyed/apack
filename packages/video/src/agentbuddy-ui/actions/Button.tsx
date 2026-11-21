import type {ButtonHTMLAttributes, ReactNode} from 'react';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import './Button.module.css';

const styles = makeStyles('ActionsButton');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'transparent' | 'ghost' | 'danger';
};

export function Button({children, className, disabled, type = 'button', variant = 'primary', ...props}: ButtonProps) {
  return (
    <button
      className={cx(styles.base, styles[disabled ? `disabled_${variant}` : variant], className)}
      disabled={disabled}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
