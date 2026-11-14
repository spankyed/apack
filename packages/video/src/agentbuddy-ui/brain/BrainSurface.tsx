import {Icons} from '../primitives/Icon';
import {BrainCanvas} from './BrainCanvas';
import {BrainDetailsPanel} from './BrainDetailsPanel';
import {BrainEventsList} from './BrainEventsList';
import {flattenBrainNodes} from './brainLayout';
import type {BrainSurfaceState} from './brainTypes';
import './BrainSurface.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('BrainSurface');

export function BrainSurface({state}: {state: BrainSurfaceState}) {
  const selected = state.selectedNodeId
    ? flattenBrainNodes(state.tracks).find(node => node.id === state.selectedNodeId)
    : undefined;

  return (
    <div className={styles.root}>
      {state.showLeftPanel ? (
        <aside className={styles.leftPanel}>
          <header className={styles.leftHeader}>
            <div className={styles.leftHeaderInner}>
              <h3 className={styles.leftTitle}>Watched Events</h3>
              {state.events.length > 0 ? (
                <span className={styles.leftCount}>
                  {state.events.length} event{state.events.length !== 1 ? 's' : ''}
                </span>
              ) : null}
            </div>
          </header>
          <BrainEventsList events={state.events} pulsingEventType={state.pulsingEventType} />
        </aside>
      ) : null}
      <BrainCanvas state={state} />
      {state.brainIsPaused ? (
        <div className={styles.paused}>
          <span>Brain Paused — Events Queued</span>
          <button className={styles.resume} type="button">Resume</button>
        </div>
      ) : null}
      {state.brainIsDead && state.tracks.length ? (
        <div className={styles.stopped}>
          <div className={styles.stoppedCard}>
            <div className={styles.stoppedIcon}><Icons.X size={28} /></div>
            <div className={styles.stoppedTitle}>Brain Stopped</div>
            <div className={styles.stoppedCopy}>This is the last known state</div>
            <button className={styles.startButton} type="button">Start Brain</button>
          </div>
        </div>
      ) : null}
      <BrainDetailsPanel node={selected} />
    </div>
  );
}
