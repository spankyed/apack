import {Icons} from '../../primitives/Icon';
import {ColorPicker} from '../../design/ColorPicker';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import type {ReactNode} from 'react';
import './CategoryImportExportSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('CategoryImportExportSettings');

type Category = {
  color: string;
  name: string;
};

type CategoryImportExportSettingsProps = {
  categories?: Category[];
  categoryDescription: string;
  categoryLabel: string;
  exportDescription: string;
  exportDirectory?: string;
  exportErrors?: string[];
  exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
  exportedFilePath?: string;
  exportedItemCount?: number;
  importErrors?: string[];
  importDescription: string;
  importStatus?: 'idle' | 'importing' | 'success' | 'error';
  importedCount?: number;
  itemLabel: string;
};

export function CategoryImportExportSettings({
  categories = [],
  categoryDescription,
  categoryLabel,
  exportDescription,
  exportDirectory = '',
  exportErrors = [],
  exportStatus = 'idle',
  exportedFilePath,
  exportedItemCount = 0,
  importErrors = [],
  importDescription,
  importStatus = 'idle',
  importedCount = 0,
  itemLabel,
}: CategoryImportExportSettingsProps) {
  const singularItem = itemLabel.endsWith('s') ? itemLabel.slice(0, -1).toLowerCase() : itemLabel.toLowerCase();

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label={categoryLabel}>
        <p className={styles.copy}>{categoryDescription}</p>
        <div className={styles.categoryGroup}>
          {categories.map((category, index) => (
            <div className={styles.categoryRow} key={`${category.name}-${index}`}>
              <ColorPicker value={category.color} />
              <input className={styles.input} readOnly type="text" value={category.name} placeholder="Category name" />
              <button className={styles.iconButton} disabled={categories.length <= 1} title="Remove category" type="button">
                <Icons.X size={16} />
              </button>
            </div>
          ))}
          <button className={styles.addButton} type="button">
            <Icons.Plus size={14} />
            Add Category
          </button>
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label={`Import ${itemLabel}`}>
        <p className={styles.copy}>{importDescription}</p>
        <div className={styles.stack}>
          <button className={styles.secondaryButton} disabled={importStatus === 'importing'} type="button">
            <Icons.Upload size={16} />
            {importStatus === 'importing' ? 'Importing...' : 'Select JSON File...'}
          </button>
          {importStatus === 'success' ? (
            <StatusCard tone="success" title={`Successfully imported ${importedCount} ${singularItem}${importedCount !== 1 ? 's' : ''}`} />
          ) : null}
          {importStatus === 'error' ? (
            <StatusCard tone="error" title="Import failed">
              <ul className={styles.statusList}>
                {importErrors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </StatusCard>
          ) : null}
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label={`Export ${itemLabel}`} defaultOpen={false}>
        <p className={styles.copy}>{exportDescription}</p>
        <div className={styles.stack}>
          <div className={styles.directoryRow}>
            <input className={styles.directoryInput} readOnly type="text" value={exportDirectory} placeholder="Select output directory..." />
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
            <StatusCard tone="success" title={`Successfully exported ${exportedItemCount} ${singularItem}${exportedItemCount !== 1 ? 's' : ''}`}>
              {exportedFilePath ? <p className={styles.statusCopy}>{exportedFilePath}</p> : null}
            </StatusCard>
          ) : null}
          {exportStatus === 'error' ? (
            <StatusCard tone="error" title="Export failed">
              <ul className={styles.statusList}>
                {exportErrors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
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
