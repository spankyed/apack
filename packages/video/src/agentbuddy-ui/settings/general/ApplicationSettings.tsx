import {Icons} from '../../primitives/Icon';
import {HotkeysSettings} from './HotkeysSettings';
import './SettingsCommon.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('SettingsCommon');

export function ApplicationSettings() {
  return (
    <div className={styles.panelNarrow}>
      <header className={styles.header}>
        <h2 className={styles.title}>Application</h2>
        <p className={styles.description}>Import setup packs, configure hotkeys, and manage app data.</p>
      </header>
      <section className={styles.card}>
        <HotkeysSettings />
      </section>
      <section className={styles.card}>
        <div className={styles.sectionHeader}><Icons.PackageOpen size={16} />Import Setup Pack</div>
        <p className={styles.description}>Import compiled actions, prompts, flows, library docs, and notes from a setup pack directory.</p>
        <button className={styles.primaryButton} type="button">Select Compiled Directory...</button>
      </section>
      <section className={styles.dangerCard}>
        <div className={styles.dangerHeader}><Icons.RotateCcw size={16} />Reset App</div>
        <p className={styles.description}>Erase all data and restore defaults. This cannot be undone.</p>
        <button className={styles.dangerButton} type="button">Reset App...</button>
      </section>
    </div>
  );
}
