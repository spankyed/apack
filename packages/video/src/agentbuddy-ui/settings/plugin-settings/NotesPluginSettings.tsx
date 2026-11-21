import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import type {ReactNode} from 'react';
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
  const exportFormat = value.exportFormat;
  const exportDirectory = value.exportDirectory ?? '';
  const importStatus = value.importStatus ?? 'idle';
  const exportStatus = value.exportStatus ?? 'idle';
  const exportCopy = exportFormat === 'markdown'
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
        <div className={styles.stack}>
          <button className={styles.secondaryButton} disabled={importStatus === 'importing'} type="button">
            <Icons.Upload size={16} />
            {importStatus === 'importing' ? 'Importing...' : 'Select Export Folder...'}
          </button>
          {importStatus === 'success' ? (
            <StatusCard tone="success" title={`Successfully imported ${value.importedCount ?? 0} note${(value.importedCount ?? 0) !== 1 ? 's' : ''}`}>
              {(value.importErrors ?? []).length > 0 ? (
                <ul className={styles.statusList}>
                  {(value.importErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
                </ul>
              ) : null}
            </StatusCard>
          ) : null}
          {importStatus === 'error' ? (
            <StatusCard tone="error" title="Import failed">
              <ul className={styles.statusList}>
                {(value.importErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </StatusCard>
          ) : null}
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Export Notes">
        <p className={styles.copy}>{exportCopy}</p>
        <div className={styles.stack}>
          <div className={styles.formatToggle}>
            <button className={styles.formatButton} data-active={exportFormat === 'markdown'} type="button">Markdown</button>
            <button className={styles.formatButton} data-active={exportFormat === 'json'} type="button">JSON</button>
          </div>
          <div className={styles.directoryRow}>
            <input
              className={styles.directoryInput}
              readOnly
              type="text"
              value={exportDirectory}
              placeholder="Select output directory..."
            />
            <button className={styles.secondaryButton} type="button">
              <Icons.FolderOpen size={16} />
              Browse
            </button>
          </div>
          <button className={styles.secondaryButton} disabled={exportStatus === 'exporting' || !exportDirectory} type="button">
            <Icons.Download size={16} />
            {exportStatus === 'exporting' ? 'Exporting...' : 'Export'}
          </button>
          {exportStatus === 'success' ? (
            <StatusCard tone="success" title={`Successfully exported ${value.exportedItemCount ?? 0} note${(value.exportedItemCount ?? 0) !== 1 ? 's' : ''}`}>
              {value.exportedFilePath ? <p className={styles.statusCopy}>{value.exportedFilePath}</p> : null}
            </StatusCard>
          ) : null}
          {exportStatus === 'error' ? (
            <StatusCard tone="error" title="Export failed">
              <ul className={styles.statusList}>
                {(value.exportErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </StatusCard>
          ) : null}
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}

function StatusCard({children, title, tone}: {children?: ReactNode; title: string; tone: 'error' | 'success'}) {
  const Icon = tone === 'success' ? Icons.CircleCheck : Icons.CircleX;

  return (
    <div className={styles.statusCard} data-tone={tone}>
      <Icon className={styles.statusIcon} size={20} />
      <div className={styles.statusBody}>
        <div className={styles.statusTitle}>{title}</div>
        {children}
      </div>
    </div>
  );
}
