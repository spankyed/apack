import type {CSSProperties} from 'react';
import {ease, mix} from '../state/timeline';
import './ChapterCard.module.css';
import {makeStyles} from '../../agentbuddy-ui/primitives/makeStyles';

const styles = makeStyles('ChapterCard');

export function ChapterCard({
  duration,
  eyebrow,
  frame,
  subtitle,
  title,
  variant,
}: {
  duration: number;
  eyebrow?: string;
  frame: number;
  subtitle?: string;
  title: string;
  variant?: 'landscape' | 'square';
}) {
  const titleIn = ease(frame, -12, 24);
  const subtitleIn = ease(frame, 12, 42);
  const exit = ease(frame, duration - 16, duration - 4);
  const opacity = Math.min(titleIn, 1 - exit);
  const y = mix(18, -10, exit) + mix(10, 0, titleIn);

  return (
    <div className={`${styles.root} ${variant === 'square' ? styles.square : ''}`}>
      <div
        className={styles.lockup}
        style={{
          opacity,
          transform: `translateY(${y}px)`,
        } as CSSProperties}
      >
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p style={{opacity: Math.min(subtitleIn, 1 - exit)}}>{subtitle}</p> : null}
      </div>
    </div>
  );
}
