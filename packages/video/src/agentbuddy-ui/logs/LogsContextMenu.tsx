import {Icons} from '../primitives/Icon';
import {makeStyles} from '../primitives/makeStyles';
import type {LogsSurfaceState} from './logTypes';
import './LogsContextMenu.module.css';

const styles = makeStyles('LogsContextMenu');

type LogsContextMenuProps = {
  contextMenu: NonNullable<LogsSurfaceState['contextMenu']>;
  excludedSources: string[];
};

// Mirrors packages/renderer/src/plugins/logs/canvas.vue source exclusion context menu.
export function LogsContextMenu({contextMenu, excludedSources}: LogsContextMenuProps) {
  if (!contextMenu.visible) return null;
  const isExcluded = excludedSources.includes(contextMenu.source);
  return (
    <div className={styles.scrim}>
      <div className={styles.menu} style={{left: `${contextMenu.x}px`, top: `${contextMenu.y}px`}}>
        <button className={styles.excludeButton} disabled={isExcluded} type="button">
          <Icons.X className={styles.excludeIcon} size={14} />
          <span>Exclude '{contextMenu.source}'</span>
        </button>
        {isExcluded ? (
          <div className={styles.alreadyExcluded}>Already excluded</div>
        ) : (
          <div className={styles.hint}>Hide all logs from this source</div>
        )}
      </div>
    </div>
  );
}
