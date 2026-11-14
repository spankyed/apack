import type {CSSProperties, ReactNode} from 'react';
import {cx} from '../agentbuddy-ui/primitives/classNames';
import {makeStyles} from '../agentbuddy-ui/primitives/makeStyles';
import {ease, mix} from './state/timeline';
import './ComponentStage.module.css';

const styles = makeStyles('ComponentStage');

export function ComponentStage({
  children,
  className,
  frame,
  height,
  variant,
  width,
}: {
  children: ReactNode;
  className?: string;
  frame: number;
  height: CSSProperties['height'];
  variant?: 'landscape' | 'square';
  width: CSSProperties['width'];
}) {
  const enter = ease(frame, 0, 24);
  return (
    <div className={cx(styles.root, variant === 'square' && styles.square)}>
      <div
        className={cx(styles.card, className)}
        style={{
          height,
          opacity: enter,
          transform: `translateY(${mix(18, 0, enter)}px) scale(${mix(0.986, 1, enter)})`,
          width,
        }}
      >
        {children}
      </div>
    </div>
  );
}
