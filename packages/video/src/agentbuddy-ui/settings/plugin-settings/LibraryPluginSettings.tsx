import {Icons} from '../../primitives/Icon';
import {ColorPicker} from '../../design/ColorPicker';
import {makeStyles} from '../../primitives/makeStyles';
import type {ReactNode} from 'react';
import type {SettingsSurfaceState} from '../settingsTypes';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import './LibraryPluginSettings.module.css';

const styles = makeStyles('LibraryPluginSettings');

type LibrarySettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['library']>;

type LibraryPluginSettingsProps = {
  settings?: LibrarySettings;
};

export function LibraryPluginSettings({settings}: LibraryPluginSettingsProps) {
  const tags = settings?.tags ?? [];
  const exportFormat = settings?.exportFormat ?? 'markdown';
  const exportDirectory = settings?.exportDirectory ?? '';
  const importStatus = settings?.importStatus ?? 'idle';
  const exportStatus = settings?.exportStatus ?? 'idle';

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Document Tags">
        <p className={styles.copy}>Manage the tags available for organizing documents</p>
        <div className={styles.tagGroup}>
          {tags.map((tag, index) => (
            <div className={styles.tagRow} key={`${tag.name}-${index}`}>
              <ColorPicker value={tag.color} />
              <input className={styles.input} readOnly type="text" value={tag.name} placeholder="Tag name" />
              <button className={styles.iconButton} disabled={tags.length <= 1} title="Remove tag" type="button">
                <Icons.X size={16} />
              </button>
            </div>
          ))}
          <button className={styles.addButton} type="button">
            <Icons.Plus size={14} />
            Add Tag
          </button>
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Import Library">
        <p className={styles.copy}>Import library items from an export folder</p>
        <div className={styles.stack}>
          <button className={styles.secondaryButton} disabled={importStatus === 'importing'} type="button">
            <Icons.Upload size={16} />
            {importStatus === 'importing' ? 'Importing...' : 'Select Export Folder...'}
          </button>
          {importStatus === 'success' ? (
            <StatusCard tone="success" title={`Successfully imported ${settings?.importedCount ?? 0} item${(settings?.importedCount ?? 0) !== 1 ? 's' : ''}`}>
              {(settings?.importErrors ?? []).length > 0 ? (
                <ul className={styles.statusList}>
                  {(settings?.importErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
                </ul>
              ) : null}
            </StatusCard>
          ) : null}
          {importStatus === 'error' ? (
            <StatusCard tone="error" title="Import failed">
              <ul className={styles.statusList}>
                {(settings?.importErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </StatusCard>
          ) : null}
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Export Library" defaultOpen={false}>
        <p className={styles.copy}>
          {exportFormat === 'markdown'
            ? 'Export library as flat markdown files with a media/ folder'
            : 'Export all library items to a JSON file (full-fidelity round-trip)'}
        </p>
        <div className={styles.stack}>
          <div className={styles.segmentedControl}>
            <button className={styles.segmentButton} data-active={exportFormat === 'markdown'} type="button">
              Markdown
            </button>
            <button className={styles.segmentButton} data-active={exportFormat === 'json'} type="button">
              JSON
            </button>
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
            <StatusCard tone="success" title={`Successfully exported ${settings?.exportedItemCount ?? 0} item${(settings?.exportedItemCount ?? 0) !== 1 ? 's' : ''}`}>
              {settings?.exportedFilePath ? <p className={styles.statusCopy}>{settings.exportedFilePath}</p> : null}
            </StatusCard>
          ) : null}
          {exportStatus === 'error' ? (
            <StatusCard tone="error" title="Export failed">
              <ul className={styles.statusList}>
                {(settings?.exportErrors ?? []).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
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
