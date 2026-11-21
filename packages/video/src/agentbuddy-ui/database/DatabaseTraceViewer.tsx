import {Icons} from '../primitives/Icon';
import type {DatabaseTraceEvent, DatabaseTraceState} from './databaseTypes';
import './DatabaseTraceViewer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('DatabaseTraceViewer');

export function DatabaseTraceViewer({state}: {state: DatabaseTraceState}) {
  const selected = state.flows.find(flow => flow.id === state.currentFlowId);
  return (
    <div className={styles.root}>
      <aside className={styles.flowPanel}>
        <header className={styles.flowHeader}>
          <button className={styles.back} type="button"><Icons.ArrowLeft size={16} />Back to Database</button>
        </header>
        <div className={styles.flowList}>
          {state.flows.map(flow => (
            <div className={styles.flowItem} data-active={flow.id === state.currentFlowId} data-status={flow.status} key={flow.id}>
              <div className={styles.flowTitle}>
                <div className={styles.flowName}><Icons.GitBranch size={14} />{flow.label}</div>
                <span className={styles.status} />
              </div>
              <div className={styles.flowMeta}>
                <span>{flow.startedAt}</span>
                {flow.completedAt ? <span>{flow.completedAt}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.flowLabel}>{selected ? <>Flow: <span>{selected.label}</span></> : 'No flow selected'}</div>
            <div className={styles.refresh}><Icons.RefreshCw size={16} /></div>
          </div>
        </header>
        <section className={styles.events}>
          <div className={styles.eventList}>
            {state.events.map(event => <TraceEventItem event={event} key={event.id} />)}
          </div>
          {state.hasMore ? <div className={styles.loadMore}><button type="button">Load More Events</button></div> : null}
        </section>
      </main>
    </div>
  );
}

function TraceEventItem({event}: {event: DatabaseTraceEvent}) {
  return (
    <article className={styles.event} data-status={event.status}>
      <div className={styles.eventHeader}>
        <span className={styles.eventDot} />
        <div className={styles.eventTitle}>{event.label}</div>
        <div className={styles.eventMeta}>{event.subtype ?? event.nodeType} {event.startedAt ? `• ${event.startedAt}` : ''}</div>
      </div>
      {event.metadata ? <pre className={styles.details}>{JSON.stringify(event.metadata, null, 2)}</pre> : null}
      {event.children?.map(child => <TraceEventItem event={child} key={child.id} />)}
    </article>
  );
}
