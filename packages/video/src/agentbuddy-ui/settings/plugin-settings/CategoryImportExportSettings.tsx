import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
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
  importDescription: string;
  itemLabel: string;
};

export function CategoryImportExportSettings({
  categories = [],
  categoryDescription,
  categoryLabel,
  exportDescription,
  importDescription,
  itemLabel,
}: CategoryImportExportSettingsProps) {
  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label={categoryLabel}>
        <p className={styles.copy}>{categoryDescription}</p>
        <div className={styles.categoryGroup}>
          {categories.map((category, index) => (
            <div className={styles.categoryRow} key={`${category.name}-${index}`}>
              <span className={styles.colorSwatch} style={{backgroundColor: category.color}} />
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
        <button className={styles.secondaryButton} type="button">
          <Icons.Upload size={16} />
          Select JSON File...
        </button>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label={`Export ${itemLabel}`} defaultOpen={false}>
        <p className={styles.copy}>{exportDescription}</p>
        <div className={styles.stack}>
          <div className={styles.directoryRow}>
            <input className={styles.directoryInput} readOnly type="text" placeholder="Select output directory..." />
            <button className={styles.secondaryButton} type="button">
              <Icons.FolderOpen size={16} />
              Browse
            </button>
          </div>
          <button className={styles.secondaryButton} type="button">
            <Icons.Download size={16} />
            Export
          </button>
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}
