import type {CSSProperties} from 'react';
import {makeStyles} from '../primitives/makeStyles';
import type {CalendarChipState} from './calendarTypes';
import './CalendarEventChip.module.css';

const styles = makeStyles('CalendarEventChip');

// Mirrors packages/renderer/src/plugins/calendar/components/EventChip.vue.
export function CalendarEventChip({chip, style}: {chip: CalendarChipState; style?: CSSProperties}) {
  return (
    <button className={styles.root} data-all-day={chip.allDay ? 'true' : undefined} style={style} type="button">
      {!chip.allDay && chip.time ? <span className={styles.time}>{chip.time}</span> : null}
      <span className={styles.title}>{chip.title}</span>
    </button>
  );
}
