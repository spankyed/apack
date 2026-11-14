import {makeStyles} from '../primitives/makeStyles';
import {CalendarEventChip} from './CalendarEventChip';
import type {CalendarDayState} from './calendarTypes';
import './CalendarDayTimeline.module.css';

const styles = makeStyles('CalendarDayTimeline');

const hourLabels = Array.from({length: 23}, (_, index) => {
  const hour = index + 1;
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${hour < 12 ? 'AM' : 'PM'}`;
});

// Mirrors packages/renderer/src/plugins/calendar/components/DayTimeline.vue.
// Remotion has no real scrolling: `scrollOffsetPx` translates the 24h track.
export function CalendarDayTimeline({state}: {state: CalendarDayState}) {
  const scrollOffset = state.scrollOffsetPx ?? 0;

  return (
    <div className={styles.root}>
      {state.allDayChips.length > 0 ? (
        <div className={styles.allDayRow}>
          <span className={styles.allDayLabel}>All day</span>
          <div className={styles.allDayChips}>
            {state.allDayChips.map(chip => (
              <CalendarEventChip chip={chip} key={chip.id} style={{width: 'auto', maxWidth: 256}} />
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.scroller}>
        <div className={styles.track} style={{transform: `translateY(${-scrollOffset}px)`}}>
          <div className={styles.gutter}>
            {Array.from({length: 24}, (_, hour) => (
              <div className={styles.gutterRow} key={hour}>
                {hour > 0 ? <span className={styles.hourLabel}>{hourLabels[hour - 1]}</span> : null}
              </div>
            ))}
          </div>
          <div className={styles.hours}>
            {Array.from({length: 24}, (_, hour) => (
              <div className={styles.hourRow} key={hour} />
            ))}
            {state.blocks.map(block => (
              <button
                className={styles.block}
                data-pressed={block.pressed ? 'true' : undefined}
                key={block.id}
                style={{
                  top: block.topPx,
                  height: block.heightPx,
                  left: `calc(${block.leftPct}% + 1px)`,
                  width: `calc(${block.widthPct}% - 3px)`,
                  opacity: block.opacity ?? 1,
                }}
                type="button"
              >
                <div className={styles.blockTitle}>{block.title}</div>
                <div className={styles.blockTime}>{block.timeLabel}</div>
              </button>
            ))}
            {state.nowLineTopPx != null ? (
              <div className={styles.nowLine} style={{top: state.nowLineTopPx}}>
                <div className={styles.nowLineBar} />
                <div className={styles.nowLineDot} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
