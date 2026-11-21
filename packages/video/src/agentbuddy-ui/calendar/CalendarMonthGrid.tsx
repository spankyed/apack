import {makeStyles} from '../primitives/makeStyles';
import {CalendarEventChip} from './CalendarEventChip';
import {calendarWeekdays, type CalendarMonthState} from './calendarTypes';
import './CalendarMonthGrid.module.css';

const styles = makeStyles('CalendarMonthGrid');

// Mirrors packages/renderer/src/plugins/calendar/components/MonthGrid.vue.
export function CalendarMonthGrid({state}: {state: CalendarMonthState}) {
  return (
    <div className={styles.root}>
      <div className={styles.weekdays}>
        {calendarWeekdays.map(day => (
          <div className={styles.weekday} key={day}>
            {day}
          </div>
        ))}
      </div>
      <div className={styles.grid}>
        {state.cells.map((cell, index) => (
          <div className={styles.cell} data-out-month={cell.inMonth ? undefined : 'true'} key={index}>
            <div className={styles.numberRow}>
              <button
                className={styles.dayNumber}
                data-hover={cell.numberHover ? 'true' : undefined}
                data-today={cell.isToday ? 'true' : undefined}
                type="button"
              >
                {cell.day}
              </button>
            </div>
            <div className={styles.chips}>
              {cell.chips.map(chip => (
                <CalendarEventChip chip={chip} key={chip.id} style={{flexShrink: 0}} />
              ))}
              {cell.moreCount ? (
                <span className={styles.more}>
                  {cell.moreCount} more event{cell.moreCount === 1 ? '' : 's'}…
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
