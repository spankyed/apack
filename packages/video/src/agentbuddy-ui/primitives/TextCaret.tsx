import type {CSSProperties} from 'react';
import {makeStyles} from './makeStyles';
import './TextCaret.module.css';

const styles = makeStyles('TextCaret');

type TextCaretProps = {
  className?: string;
  frame?: number;
  leading?: boolean;
  style?: CSSProperties;
  visible?: boolean;
};

export function TextCaret({className, frame, leading = false, style, visible = true}: TextCaretProps) {
  if (!visible) return null;

  const opacity = typeof frame === 'number'
    ? Math.sin(frame * 0.55) > 0 ? 1 : 0.15
    : undefined;

  return (
    <span
      aria-hidden="true"
      className={`${styles.root} ${leading ? styles.leading : styles.trailing}${className ? ` ${className}` : ''}`}
      style={{opacity, ...style}}
    />
  );
}
