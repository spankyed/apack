import {Icons} from '../../primitives/Icon';
import {cx} from '../../primitives/classNames';
import type {SetupPackImportState, SetupPackType} from '../settingsTypes';
import './ImportSetupPackPicker.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('ImportSetupPackPicker');

const typeMeta: Array<{key: SetupPackType; label: string; icon: React.ComponentType<{size?: number; className?: string}>; hint?: string}> = [
  {key: 'actions', label: 'Actions', icon: Icons.Zap},
  {key: 'prompts', label: 'Prompts', icon: Icons.MessageSquare},
  {
    key: 'flows',
    label: 'Flows',
    icon: Icons.GitBranch,
    hint: 'Flows reference actions and prompts by label. Any referenced action/prompt must already exist in the database (or be imported in the same run) or the flow will be skipped.',
  },
  {key: 'library', label: 'Library', icon: Icons.Library},
  {key: 'notes', label: 'Notes', icon: Icons.StickyNote},
  {key: 'settings', label: 'Settings', icon: Icons.Settings},
];

const importModes = [
  {value: 'keep-existing', label: 'Keep existing'},
  {value: 'replace-on-collision', label: 'Replace'},
  {value: 'wipe-and-replace', label: 'Wipe & replace'},
] as const;

export function ImportSetupPackPicker({state}: {state: SetupPackImportState}) {
  const expanded = state.expanded ?? emptyExpanded;
  const selection = state.selection ?? emptySelection;
  const types = state.types ?? emptyTypes;
  const missing = new Set(state.missing ?? []);
  const importing = state.status === 'importing';
  const rows = typeMeta.map(meta => {
    const items = types[meta.key] ?? [];
    const selectedCount = selection[meta.key]?.length ?? 0;
    const isMissing = missing.has(meta.key);
    return {
      ...meta,
      allSelected: items.length > 0 && selectedCount === items.length,
      indeterminate: selectedCount > 0 && selectedCount < items.length,
      isEmpty: isMissing || items.length === 0,
      items,
      missing: isMissing,
      selectedCount,
      totalCount: items.length,
    };
  });
  const totalSelected = rows.reduce((sum, row) => sum + row.selectedCount, 0);
  const importMode = state.importMode ?? 'replace-on-collision';

  return (
    <div className={styles.root}>
      <p className={styles.directory} title={state.directory}>{state.directory}</p>
      <div className={styles.rows}>
        {rows.map(row => {
          const Icon = row.icon;
          const Chevron = expanded[row.key] ? Icons.ChevronDown : Icons.ChevronRight;
          return (
            <div key={row.key}>
              <div className={styles.typeRow} data-empty={row.isEmpty} title={row.hint}>
                <button className={styles.chevron} disabled={row.isEmpty || importing} type="button">
                  <Chevron size={16} />
                </button>
                <span
                  aria-checked={row.indeterminate ? 'mixed' : row.allSelected}
                  className={styles.checkbox}
                  data-checked={row.allSelected}
                  data-indeterminate={row.indeterminate}
                  role="checkbox"
                />
                <Icon className={styles.typeIcon} size={16} />
                <span className={styles.label}>{row.label}</span>
                <span className={styles.count}>{row.missing ? 'not found' : row.isEmpty ? 'no items' : `${row.selectedCount} / ${row.totalCount} items`}</span>
              </div>
              {expanded[row.key] && !row.isEmpty ? (
                <div className={styles.itemList}>
                  {row.items.map(item => (
                    <label className={styles.item} data-disabled={importing} key={item.key}>
                      <span className={styles.itemCheckbox} data-checked={selection[row.key]?.includes(item.key)} />
                      <span className={styles.itemCopy}>
                        <span className={styles.itemTitle}>
                          <span>{item.key}</span>
                          {item.childCount ? <span className={styles.childCount}>({item.childCount} children)</span> : null}
                        </span>
                        {item.description ? <span className={styles.itemDescription} title={item.description}>{item.description}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={styles.modeGroup}>
        {importModes.map(mode => (
          <button className={styles.modeButton} data-active={importMode === mode.value} disabled={importing} key={mode.value} type="button">
            {mode.label}
          </button>
        ))}
      </div>
      <label className={styles.restart}>
        <span className={styles.itemCheckbox} data-checked={state.restartBrain} />
        <span>Restart brain after import</span>
      </label>
      <div className={styles.footer}>
        <button className={cx(styles.importButton, (importing || totalSelected === 0) && styles.disabled)} disabled={importing || totalSelected === 0} type="button">
          {importing ? 'Importing...' : `Import Selected (${totalSelected})`}
        </button>
        <button className={styles.cancelButton} disabled={importing} type="button">Cancel</button>
      </div>
    </div>
  );
}

const emptyExpanded: Record<SetupPackType, boolean> = {
  actions: false,
  prompts: false,
  flows: false,
  library: false,
  notes: false,
  settings: false,
};

const emptySelection: Record<SetupPackType, string[]> = {
  actions: [],
  prompts: [],
  flows: [],
  library: [],
  notes: [],
  settings: [],
};

const emptyTypes: NonNullable<SetupPackImportState['types']> = {
  actions: [],
  prompts: [],
  flows: [],
  library: [],
  notes: [],
  settings: [],
};
