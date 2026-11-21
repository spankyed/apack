import {Icons} from '../../primitives/Icon';
import {makeStyles} from '../../primitives/makeStyles';
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

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Document Tags">
        <p className={styles.copy}>Manage the tags available for organizing documents</p>
        <div className={styles.tagGroup}>
          {tags.map((tag, index) => (
            <div className={styles.tagRow} key={`${tag.name}-${index}`}>
              <span className={styles.colorSwatch} style={{backgroundColor: tag.color}} />
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
        <button className={styles.secondaryButton} type="button">
          <Icons.Upload size={16} />
          Select Export Folder...
        </button>
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
              value={settings?.exportDirectory ?? ''}
              placeholder="Select output directory..."
            />
            <button className={styles.secondaryButton} type="button">
              <Icons.FolderOpen size={16} />
              Browse
            </button>
          </div>
          <button className={styles.secondaryButton} disabled={!settings?.exportDirectory} type="button">
            <Icons.Download size={16} />
            Export
          </button>
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}
