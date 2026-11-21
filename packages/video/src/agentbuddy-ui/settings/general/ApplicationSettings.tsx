import {Icons} from '../../primitives/Icon';
import {HotkeysSettings} from './HotkeysSettings';
import {ImportSetupPackPicker} from './ImportSetupPackPicker';
import type {SettingsSurfaceState} from '../settingsTypes';
import './SettingsCommon.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('SettingsCommon');

export function ApplicationSettings({state}: {state: SettingsSurfaceState}) {
  const importStatus = state.setupPackImport?.status ?? 'idle';
  const importing = importStatus === 'importing';
  const previewReady = importStatus === 'selecting' || importing;
  return (
    <div className={styles.panelNarrow}>
      <header className={styles.header}>
        <h2 className={styles.title}>Application</h2>
        <p className={styles.description}>Import setup packs, configure hotkeys, and manage app data.</p>
      </header>
      <section className={styles.card}>
        <HotkeysSettings hotkeys={state.applicationHotkeys} />
      </section>
      <section className={styles.card}>
        <div className={styles.sectionHeader}><Icons.PackageOpen size={16} />Import Setup Pack</div>
        <p className={styles.description}>Import compiled actions, prompts, flows, library docs, and notes from a setup pack directory.</p>
        {importStatus === 'idle' || importStatus === 'previewing' ? (
          <button className={styles.primaryButton} data-status={importStatus} disabled={importStatus === 'previewing'} type="button">
            {importStatus === 'previewing' ? 'Reading pack...' : 'Select Compiled Directory...'}
          </button>
        ) : null}
        {previewReady && state.setupPackImport ? <ImportSetupPackPicker state={state.setupPackImport} /> : null}
        {importStatus === 'success' && state.setupPackImport?.result ? (
          <div className={styles.successNotice}>
            <p>Import complete</p>
            <div>
              <span>Actions — {state.setupPackImport.result.actions.created} created, {state.setupPackImport.result.actions.updated ?? 0} updated</span>
              <span>Prompts — {state.setupPackImport.result.prompts.created} created, {state.setupPackImport.result.prompts.updated ?? 0} updated</span>
              <span>Flows — {state.setupPackImport.result.flows.created} created, {state.setupPackImport.result.flows.skipped ?? 0} skipped</span>
              <span>Library — {state.setupPackImport.result.library.created} created, {state.setupPackImport.result.library.updated ?? 0} updated</span>
              <span>Notes — {state.setupPackImport.result.notes.created} created, {state.setupPackImport.result.notes.updated ?? 0} updated</span>
            </div>
            <button type="button">Import another pack</button>
          </div>
        ) : null}
        {importStatus === 'error' && state.setupPackImport?.error ? (
          <div className={styles.errorNotice}>
            <p>Import failed: {state.setupPackImport.error}</p>
            <button type="button">Try again</button>
          </div>
        ) : null}
      </section>
      <section className={styles.dangerCard}>
        <div className={styles.dangerHeader}><Icons.RotateCcw size={16} />Reset App</div>
        <p className={styles.description}>Erase all data and restore defaults. This cannot be undone.</p>
        {!state.confirmingReset ? (
          <button className={styles.dangerButton} type="button">Reset App...</button>
        ) : (
          <div className={styles.confirmRow}>
            <span>Are you sure?</span>
            <button className={styles.dangerButton} disabled={state.resetting} type="button">
              {state.resetting ? 'Resetting…' : 'Yes, erase everything'}
            </button>
            <button className={styles.secondaryButton} disabled={state.resetting} type="button">Cancel</button>
          </div>
        )}
      </section>
    </div>
  );
}
