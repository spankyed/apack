import {Icons} from '../primitives/Icon';
import type {BrainEventState} from './brainTypes';
import './BrainEventsList.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('BrainEventsList');

export function BrainEventsList({events, pulsingEventType}: {events: BrainEventState[]; pulsingEventType?: string}) {
  if (events.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <Icons.Radio size={24} />
        </div>
        <p>No event listeners in this flow</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {events.map(event => {
        const active = pulsingEventType === event.eventType;
        const Icon = event.triggerType === 'schedule' ? Icons.Clock : Icons.Radio;
        return (
          <div
            className={styles.row}
            data-active={active}
            data-dimmed={Boolean(pulsingEventType && !active)}
            data-trigger={event.triggerType ?? 'listener'}
            key={event.id}
          >
            <div className={styles.inner}>
              <div className={styles.copy}>
                <div className={styles.title}>{event.label}</div>
                <div className={styles.meta}>
                  <span className={styles.eventType}>{eventSubtitle(event)}</span>
                  <span>•</span>
                  <span>{event.triggerType === 'schedule' ? 'schedule' : event.scope}</span>
                </div>
              </div>
              <span className={styles.icon}><Icon size={14} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function eventSubtitle(event: BrainEventState) {
  if (event.triggerType === 'schedule' && event.cronExpression) {
    return cronToHuman(event.cronExpression);
  }
  return event.eventType;
}

function cronToHuman(expression: string) {
  const normalized = expression.trim().replace(/\s+/g, ' ');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const match = normalized.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/);
  if (match) {
    const [, minute, hour, day] = match;
    return `${dayNames[Number(day)]} at ${formatTime(Number(hour), Number(minute))}`;
  }
  if (normalized === '0 9 * * *') return 'Daily at 9:00 AM';
  return expression;
}

function formatTime(hour24: number, minute: number) {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
}
