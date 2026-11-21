import {Icons} from '../../primitives/Icon';
import {KeyboardShortcutInput} from './KeyboardShortcutInput';
import type {SettingsSurfaceState} from '../settingsTypes';
import './HotkeysSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('HotkeysSettings');

type HotkeysSettingsProps = {
  hotkeys?: SettingsSurfaceState['applicationHotkeys'];
};

export function HotkeysSettings({hotkeys}: HotkeysSettingsProps) {
  const customHotkeys = hotkeys?.custom ?? [];

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.title}>Keyboard Shortcuts</h2>
        <p className={styles.description}>Configure keyboard shortcuts for common actions in the application.</p>
      </header>
      <div className={styles.group}>
        <div className={styles.row}>
          <KeyboardShortcutInput label="Previous Plugin" showResetButton={false} value={hotkeys?.switchPluginUp ?? '⌘ ↑'} />
          <KeyboardShortcutInput label="Next Plugin" showResetButton={false} value={hotkeys?.switchPluginDown ?? '⌘ ↓'} />
        </div>
        <p className={styles.hint}>Navigate between plugins using keyboard shortcuts</p>
      </div>
      <div className={styles.group}>
        <div className={styles.row}>
          <KeyboardShortcutInput label="Toggle Inspection Panel" showResetButton={false} value={hotkeys?.toggleInspectionPanel ?? '⌘ I'} />
          <div style={{flex: 1}} />
        </div>
        <p className={styles.hint}>Show or hide the inspection panel</p>
      </div>
      <div className={styles.divider} />
      <div className={styles.group}>
        <h3 className={styles.sectionTitle}>Custom Keyboard Shortcuts</h3>
        {customHotkeys.length > 0 ? (
          <div className={styles.customList}>
            {customHotkeys.map(hotkey => (
              <div className={styles.customItem} key={hotkey.id}>
                <div className={styles.customRow}>
                  <input className={styles.eventInput} readOnly type="text" value={hotkey.eventName} />
                  <KeyboardShortcutInput showResetButton={false} value={hotkey.shortcut} />
                  <button className={styles.removeButton} title="Remove shortcut" type="button">
                    <Icons.X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <button className={styles.add} type="button"><Icons.Plus size={16} />Add Custom Shortcut</button>
      </div>
    </div>
  );
}
