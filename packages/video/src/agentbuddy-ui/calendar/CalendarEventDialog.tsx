import {X} from 'lucide-react';
import {makeStyles} from '../primitives/makeStyles';
import {TextCaret} from '../primitives/TextCaret';
import type {CalendarDialogState} from './calendarTypes';
import './CalendarEventDialog.module.css';

const styles = makeStyles('CalendarEventDialog');

// Mirrors packages/renderer/src/plugins/calendar/components/EventEditorDialog.vue
// wrapped in @/core/components/design/dialog.vue chrome.
export function CalendarEventDialog({frame, state}: {frame?: number; state: CalendarDialogState}) {
  const opacity = state.opacity ?? 1;

  return (
    <div className={styles.overlay} style={{opacity}}>
      <div className={styles.panel} style={{transform: `scale(${0.96 + 0.04 * opacity})`}}>
        <div className={styles.title}>{state.mode === 'create' ? 'New Event' : 'Edit Event'}</div>
        <button className={styles.close} type="button">
          <X size={20} strokeWidth={2} />
        </button>

        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>Title</label>
            <div className={styles.input} data-placeholder={state.title ? undefined : 'true'}>
              {state.title || 'Event title'}
              <TextCaret frame={frame} visible={Boolean(state.caretVisible)} />
            </div>
          </div>

          <label className={styles.allDayRow}>
            <span className={styles.checkbox} data-checked={state.allDay ? 'true' : undefined} />
            All day
          </label>

          <div className={styles.timeGrid}>
            <div className={styles.field}>
              <label className={styles.label}>Start</label>
              <div className={styles.input}>{state.startValue}</div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>End</label>
              <div className={styles.input}>{state.endValue}</div>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Notes</label>
            <div className={styles.textarea} data-placeholder={state.notes ? undefined : 'true'}>
              {state.notes || 'Optional notes'}
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          {state.mode === 'edit' ? (
            <button className={styles.deleteButton} type="button">
              Delete
            </button>
          ) : null}
          <button className={styles.cancelButton} type="button">
            Cancel
          </button>
          <button className={styles.saveButton} data-hover={state.saveHover ? 'true' : undefined} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
