import {ChevronLeft, ChevronRight} from 'lucide-react';
import {makeStyles} from '../primitives/makeStyles';
import {calendarPickerWeekdays, type CalendarPickerState} from './calendarTypes';
import './CalendarDatePicker.module.css';

const styles = makeStyles('CalendarDatePicker');

// Mirrors packages/renderer/src/plugins/calendar/components/DatePickerPopover.vue.
// Rendered statically as an open popover anchored under the header label.
export function CalendarDatePicker({state}: {state: CalendarPickerState}) {
  return (
    <div className={styles.root} data-mode={state.mode}>
      <div className={styles.header}>
        <button className={styles.navButton} type="button">
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span className={styles.headerLabel}>{state.headerLabel}</span>
        <button className={styles.navButton} type="button">
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>

      {state.mode === 'month' ? (
        <div className={styles.monthGrid}>
          {state.months.map(month => (
            <button
              className={styles.monthCell}
              data-current={month.isCurrent && !month.selected ? 'true' : undefined}
              data-selected={month.selected ? 'true' : undefined}
              key={month.label}
              type="button"
            >
              {month.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className={styles.weekdays}>
            {calendarPickerWeekdays.map(weekday => (
              <span className={styles.weekday} key={weekday}>
                {weekday}
              </span>
            ))}
          </div>
          <div className={styles.dayGrid}>
            {state.cells.map((cell, index) => (
              <button
                className={styles.dayCell}
                data-out-month={cell.inMonth ? undefined : 'true'}
                data-selected={cell.isSelected ? 'true' : undefined}
                data-today={cell.isToday && !cell.isSelected ? 'true' : undefined}
                key={index}
                type="button"
              >
                {cell.day}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
