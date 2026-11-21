import {Icons} from '../primitives/Icon';
import {cx} from '../primitives/classNames';
import {makeStyles} from '../primitives/makeStyles';
import type {DatabaseGraphState} from './databaseTypes';
import './DatabaseGraphToolbar.module.css';

const styles = makeStyles('DatabaseGraphToolbar');

const layouts = [
  {type: 'd3-force', name: 'Force', description: 'Force-directed layout for organic network visualization'},
  {type: 'circular', name: 'Circular', description: 'Circular layout for showing all nodes equally'},
  {type: 'grid', name: 'Grid', description: 'Grid layout for organized structure'},
  {type: 'radial', name: 'Radial', description: 'Radial layout for hierarchical visualization'},
] as const;

type DatabaseGraphToolbarProps = {
  state: DatabaseGraphState;
};

export function DatabaseGraphToolbar({state}: DatabaseGraphToolbarProps) {
  const hasData = state.nodes.length > 0;
  const canZoomIn = hasData && state.zoomLevel < 3;
  const canZoomOut = hasData && state.zoomLevel > 0.3;
  const FullscreenIcon = state.isFullscreen ? Icons.Minimize2 : Icons.Maximize;

  return (
    <div className={styles.root}>
      <div className={styles.left}>
        <div className={styles.layoutSelector}>
          {layouts.map(layout => (
            <button
              className={cx(styles.layoutButton, state.currentLayout === layout.type && styles.layoutButtonActive)}
              data-disabled={!hasData}
              disabled={!hasData}
              key={layout.type}
              title={layout.description}
              type="button"
            >
              {layout.name}
            </button>
          ))}
        </div>
        <div className={styles.stats}>
          <StatDot color="blue" count={state.nodes.length} singular="node" />
          <div className={styles.statsDivider} />
          <StatDot color="neutral" count={state.edges.length} singular="edge" />
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.viewControls}>
          <button className={styles.iconButton} disabled={!canZoomOut} title="Zoom out (Ctrl+-)" type="button">
            <Icons.ZoomOut size={16} />
          </button>
          <div className={styles.zoomLabel}>{Math.round(state.zoomLevel * 100)}%</div>
          <button className={styles.iconButton} disabled={!canZoomIn} title="Zoom in (Ctrl+=)" type="button">
            <Icons.ZoomIn size={16} />
          </button>
          <div className={styles.controlDivider} />
          <button className={styles.iconButton} disabled={!hasData} title="Fit to view (Ctrl+0)" type="button">
            <Icons.Maximize2 size={16} />
          </button>
          <button className={cx(styles.iconButton, state.isFullscreen && styles.iconButtonActive)} title="Toggle fullscreen (F11)" type="button">
            <FullscreenIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatDot({color, count, singular}: {color: 'blue' | 'neutral'; count: number; singular: string}) {
  return (
    <div className={styles.stat}>
      <div className={color === 'blue' ? styles.dotBlue : styles.dotNeutral} />
      <span className={styles.statCount}>{count}</span>
      <span className={styles.statLabel}>{count === 1 ? singular : `${singular}s`}</span>
    </div>
  );
}
