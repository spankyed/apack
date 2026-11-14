import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {DataRenderer} from '../logs/DataRenderer';
import type {DatabaseTraceEvent, DatabaseTraceState} from './databaseTypes';
import './DatabaseTraceViewer.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('DatabaseTraceViewer');

export function DatabaseTraceViewer({state}: {state: DatabaseTraceState}) {
  const selected = state.flows.find(flow => flow.id === state.currentFlowId);
  const expandedIds = new Set(state.expandedEventIds ?? []);
  return (
    <div className={styles.root}>
      <aside className={styles.flowPanel}>
        <div className={styles.flowPanelHeader}>
          <button className={styles.backButton} type="button">
            <Icons.ArrowLeft size={16} />
            <span>Back to Database</span>
          </button>
        </div>
        <div className={styles.flowList}>
          {state.flows.length === 0 && !state.isLoading ? (
            <div className={styles.emptyFlows}>
              <p>No trace flows found</p>
              <span>Run a flow to generate trace data</span>
            </div>
          ) : state.flows.length === 0 && state.isLoading ? (
            <div className={styles.loadingFlows}>
              <div><Icons.Loader2 className={styles.refreshing} size={20} /></div>
              <p>Loading flows...</p>
            </div>
          ) : (
            state.flows.map(flow => (
              <div className={styles.flowItem} data-active={flow.id === state.currentFlowId} data-status={flow.status} key={flow.id}>
                <div className={styles.flowTitle}>
                  <div className={styles.flowName}><Icons.GitBranch size={14} />{flow.label}</div>
                  <span className={styles.status} />
                </div>
                <div className={styles.flowMeta}>
                  <span>{flow.startedAt}</span>
                  {flow.completedAt ? <span>{flow.completedAt}</span> : null}
                </div>
                <div className={styles.flowId}>{flow.id}</div>
              </div>
            ))
          )}
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.flowLabel}>{selected ? <>Flow: <span>{selected.label}</span></> : 'No flow selected'}</div>
            <button className={styles.refresh} disabled={state.isLoading} title="Refresh trace data" type="button">
              <Icons.RefreshCw className={state.isLoading ? styles.refreshing : undefined} size={16} />
            </button>
          </div>
        </header>
        <section className={styles.events}>
          {!selected ? (
            <div className={styles.noFlow}>
              <div className={styles.noFlowIcon}><Icons.History size={24} /></div>
              <p>No flow selected</p>
              <span>Select a flow from the left panel to view its event trace</span>
            </div>
          ) : state.events.length > 0 ? (
            <div className={styles.eventList}>
              {state.events.map(event => <TraceEventItem event={event} expandedIds={expandedIds} key={event.id} />)}
            </div>
          ) : (
            <div className={styles.emptyEvents}>
              <div className={styles.emptyIcon}><Icons.ClipboardList size={24} /></div>
              <p>No events in this flow</p>
            </div>
          )}
          {state.hasMore ? (
            <div className={styles.loadMore}>
              <button disabled={state.isLoading} type="button">
                {state.isLoading ? <Icons.Loader2 className={styles.refreshing} size={16} /> : null}
                <span>{state.isLoading ? 'Loading...' : 'Load More Events'}</span>
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function TraceEventItem({event, expandedIds}: {event: DatabaseTraceEvent; expandedIds: Set<string>}) {
  const hasChildren = Boolean(event.children?.length);
  const hasDetails = event.nodeType === 'flow' || event.nodeType === 'step' || event.nodeType === 'event' || Boolean(event.metadata);
  const expanded = expandedIds.has(event.id);
  const effectiveType = event.nodeType === 'event' ? 'listener' : event.subtype ?? event.nodeType;
  return (
    <article className={cx(styles.event, expanded && styles.eventExpanded, hasChildren && styles.eventWithChildren)} data-kind={effectiveType} data-status={event.status}>
      <button className={styles.eventHeader} type="button">
        {hasChildren || hasDetails ? <Icons.ChevronRight className={cx(styles.eventChevron, expanded && styles.eventChevronExpanded)} size={14} /> : null}
        <span className={styles.eventDot} />
        <div className={styles.eventLabel}>
          <span>{event.label}</span>
          {event.startedAt ? <time>{event.startedAt}</time> : null}
        </div>
        <NodeTypeIcon kind={effectiveType} />
        <span className={styles.statusDot} />
      </button>
      {expanded && event.metadata ? (
        <div className={styles.details}>
          <div className={styles.attributes}>
            <div className={styles.detailsTitle}>Node Attributes</div>
            <DataRenderer compact data={event.metadata} />
          </div>
          <TraceEventMeta event={event} effectiveType={effectiveType} />
        </div>
      ) : expanded ? (
        <div className={styles.details}>
          <TraceEventMeta event={event} effectiveType={effectiveType} />
        </div>
      ) : null}
      {expanded && event.children?.length ? (
        <div className={styles.children}>
          {event.children.map(child => <TraceEventItem event={child} expandedIds={expandedIds} key={child.id} />)}
        </div>
      ) : null}
    </article>
  );
}

function TraceEventMeta({effectiveType, event}: {effectiveType: string; event: DatabaseTraceEvent}) {
  return (
    <div className={cx(styles.metaStrip, event.metadata && styles.metaStripBordered)}>
      <div className={styles.metaLeft}>
        <span className={event.nodeType === 'flow' ? styles.flowType : event.nodeType === 'event' ? styles.eventType : styles.stepType}>
          {event.nodeType === 'step' ? effectiveType : event.nodeType === 'event' ? effectiveType : 'flow'}
        </span>
        <span className={styles.entityId}>{event.id}</span>
      </div>
      <div className={styles.metaRight}>
        {event.startedAt ? (
          <span>
            <span className={styles.metaLabel}>Started:</span>
            <span className={styles.metaValue}>{event.startedAt}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function NodeTypeIcon({kind}: {kind: string}) {
  if (kind === 'flow') return <Icons.Flows className={styles.typeIcon} size={14} />;
  if (kind === 'listener') return <Icons.Radio className={styles.typeIcon} size={14} />;
  return <Icons.Play className={styles.typeIcon} size={14} />;
}
