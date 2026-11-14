import {Icons} from '../primitives/Icon';
import type {BrainEventState} from './brainTypes';
import './BrainEventsList.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('BrainEventsList');

export function BrainEventsList({events, pulsingEventType}: {events: BrainEventState[]; pulsingEventType?: string}) {
  if (events.length === 0) {
    return (
      <div className={styles.empty}>
        <Icons.Radio size={24} />
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
              <div>
                <div className={styles.title}>{event.label}</div>
                <div className={styles.meta}>
                  <span className={styles.eventType}>{event.eventType}</span>
                  <span>•</span>
                  <span>{event.triggerType === 'schedule' ? 'schedule' : event.scope ?? 'app'}</span>
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
