import {ChevronLeft, ChevronRight, Plus} from 'lucide-react';
import {makeStyles} from '../primitives/makeStyles';
import {CalendarDatePicker} from './CalendarDatePicker';
import {CalendarDayTimeline} from './CalendarDayTimeline';
import {CalendarEventDialog} from './CalendarEventDialog';
import {CalendarMonthGrid} from './CalendarMonthGrid';
import type {CalendarSurfaceState} from './calendarTypes';
import './CalendarSurface.module.css';

const styles = makeStyles('CalendarSurface');

// Mirrors packages/renderer/src/plugins/calendar/canvas.vue.
export function CalendarSurface({frame, state}: {frame?: number; state: CalendarSurfaceState}) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerNav}>
          <button className={styles.navButton} type="button">
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
          <button className={styles.label} data-hover={state.labelHover ? 'true' : undefined} type="button">
            {state.headerLabel}
          </button>
          <button className={styles.navButton} type="button">
            <ChevronRight size={18} strokeWidth={2} />
          </button>
          <button className={styles.todayButton} data-hover={state.todayHover ? 'true' : undefined} type="button">
            Today
          </button>
          {state.picker ? (
            <div className={styles.pickerAnchor}>
              <CalendarDatePicker state={state.picker} />
            </div>
          ) : null}
        </div>
        <button className={styles.newEventButton} data-hover={state.newEventHover ? 'true' : undefined} type="button">
          <Plus size={16} strokeWidth={2} />
          New Event
        </button>
      </div>

      <div className={styles.body}>
        {state.view === 'day' && state.day ? (
          <CalendarDayTimeline state={state.day} />
        ) : state.month ? (
          <CalendarMonthGrid state={state.month} />
        ) : null}
      </div>

      {state.dialog ? <CalendarEventDialog frame={frame} state={state.dialog} /> : null}
    </div>
  );
}
