import {KeyboardShortcutInput} from '../general/KeyboardShortcutInput';
import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import './DatabasePluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('DatabasePluginSettings');

export function DatabasePluginSettings({executeQueryShortcut = '⌘ ↵'}: {executeQueryShortcut?: string}) {
  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Database Hotkeys">
        <p className={styles.copy}>Keyboard shortcuts for database operations</p>
        <KeyboardShortcutInput label="Execute Query" value={executeQueryShortcut} />
        <p className={styles.hint}>Run the current query or transaction in the editor</p>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Backup & Restore" defaultOpen={false}>
        <p className={styles.copy}>Export and import database backups.</p>
        <button className={styles.button} type="button"><Icons.HardDriveDownload size={16} />Open Backup & Restore</button>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Danger Zone" defaultOpen={false}>
        <div className={styles.danger}>
          <div className={styles.dangerTitle}>Reset Database</div>
          <p className={styles.dangerCopy}>This will permanently delete all data from the database and create a new root flow. This action cannot be undone.</p>
          <button className={styles.dangerButton} type="button">Reset Database</button>
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}
