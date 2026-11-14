import './SettingsCommon.module.css';
import './JsonSettingsEditor.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const common = makeStyles('SettingsCommon');
const styles = makeStyles('JsonSettingsEditor');

export function JsonSettingsEditor({value}: {value: string}) {
  return (
    <div className={common.panelNarrow}>
      <header className={styles.header}>
        <div>
          <h2 className={common.title}>Settings JSON</h2>
        </div>
        <div className={styles.actions}>
          <button className={styles.resetButton} type="button">Reset</button>
          <button className={styles.saveButton} disabled type="button">Save</button>
        </div>
      </header>
      <div className={styles.editorFrame}>
        <textarea className={styles.editor} readOnly value={value} />
      </div>
    </div>
  );
}
