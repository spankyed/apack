import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import type {SettingsSurfaceState} from '../settingsTypes';
import './NotesPluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('NotesPluginSettings');

type NotesSettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['notes']>;

const defaultNotesSettings: NotesSettings = {
  exportFormat: 'markdown',
  tasklistPanelPosition: 'left',
};

export function NotesPluginSettings({settings}: {settings?: NotesSettings}) {
  const value = settings ?? defaultNotesSettings;
  const exportCopy = value.exportFormat === 'markdown'
    ? 'Export notes as markdown files with frontmatter'
    : 'Export all notes to a JSON file (full-fidelity round-trip)';

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Task List">
        <div className={styles.stack}>
          <div className={styles.row}>
            <span className={styles.label}>Panel Position:</span>
            <div className={styles.segmented}>
              <button className={styles.segment} data-active={value.tasklistPanelPosition === 'left'} type="button">Left</button>
              <button className={styles.segment} data-active={value.tasklistPanelPosition === 'right'} type="button">Right</button>
            </div>
          </div>
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Import Notes">
        <p className={styles.copy}>Import notes from an export folder</p>
        <button className={styles.secondaryButton} type="button">
          <Icons.Upload size={16} />
          Select Export Folder...
        </button>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Export Notes">
        <p className={styles.copy}>{exportCopy}</p>
        <div className={styles.stack}>
          <div className={styles.formatToggle}>
            <button className={styles.formatButton} data-active={value.exportFormat === 'markdown'} type="button">Markdown</button>
            <button className={styles.formatButton} data-active={value.exportFormat === 'json'} type="button">JSON</button>
          </div>
          <div className={styles.directoryRow}>
            <input
              className={styles.directoryInput}
              readOnly
              type="text"
              value={value.exportDirectory ?? ''}
              placeholder="Select output directory..."
            />
            <button className={styles.secondaryButton} type="button">
              <Icons.FolderOpen size={16} />
              Browse
            </button>
          </div>
          <button className={styles.secondaryButton} disabled={!value.exportDirectory} type="button">
            <Icons.Download size={16} />
            Export
          </button>
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}
