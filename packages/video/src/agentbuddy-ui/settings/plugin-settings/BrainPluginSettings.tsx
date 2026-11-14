import {Icons} from '../../primitives/Icon';
import type {SettingsSurfaceState} from '../settingsTypes';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import './BrainPluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('BrainPluginSettings');

type BrainPluginSettingsState = NonNullable<SettingsSurfaceState['selectedPluginSettings']>['brain'];

export function BrainPluginSettings({settings}: {settings?: BrainPluginSettingsState}) {
  const brainIsDead = settings?.brainIsDead ?? false;
  const needsRestart = !brainIsDead && (settings?.needsRestart ?? false);
  const inspectEnabled = settings?.inspectEnabled ?? false;

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Brain Status">
        <div className={styles.stack}>
          {brainIsDead ? <BrainStoppedCard /> : null}
          {needsRestart ? <BrainRestartCard /> : null}
          {!brainIsDead && !needsRestart ? <BrainRunningCard /> : null}
        </div>
      </CollapsiblePluginSection>
      <CollapsiblePluginSection label="Inspect Mode" defaultOpen={false}>
        <p className={styles.copy}>Enable inspect mode to see detailed brain execution information in the inspection panel</p>
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Inspect Mode:</span>
          <button className={styles.toggle} data-enabled={inspectEnabled} type="button">{inspectEnabled ? 'Enabled' : 'Disabled'}</button>
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}

function BrainStoppedCard() {
  return (
    <div className={styles.card} data-state="stopped">
      <div className={styles.statusRow}>
        <Icons.Power className={styles.statusIcon} size={20} />
        <div>
          <div className={styles.statusTitle}>Brain Stopped</div>
          <p className={styles.statusCopy}>The brain system is currently inactive. Start it to begin dialog execution.</p>
        </div>
      </div>
      <div className={styles.lowerBlock}>
        <button className={styles.button} data-tone="success" data-onboarding-id="settings-restart-brain-button" type="button">
          <Icons.PlayCircle size={16} />
          Start Brain
        </button>
      </div>
    </div>
  );
}

function BrainRestartCard() {
  return (
    <div className={styles.card} data-state="restart">
      <div className={styles.statusRow}>
        <Icons.AlertTriangle className={styles.statusIcon} size={20} />
        <div>
          <div className={styles.statusTitle}>Root Flow Changed</div>
          <p className={styles.statusCopy}>Restart the brain to apply the changes and ensure the brain system utilizes the latest flow configuration.</p>
        </div>
      </div>
      <div className={styles.lowerBlock}>
        <div className={styles.actions}>
          <button className={styles.button} data-tone="warning" data-onboarding-id="settings-restart-brain-button" type="button">
            <Icons.RefreshCw size={16} />
            Restart Brain
          </button>
          <button className={styles.button} data-tone="danger" data-onboarding-id="settings-kill-brain-button" type="button">
            <Icons.Power size={16} />
            Kill Brain
          </button>
        </div>
      </div>
    </div>
  );
}

function BrainRunningCard() {
  return (
    <div className={styles.card} data-state="running">
      <div className={styles.statusRow}>
        <Icons.CircleCheck className={styles.statusIcon} size={20} />
        <div>
          <div className={styles.statusTitle}>Brain Running</div>
          <p className={styles.statusCopy}>The brain system is active and executing the current root flow.</p>
        </div>
      </div>
      <div className={styles.lowerBlock}>
        <p className={styles.caution}>Caution: this will stop everything that's currently running.</p>
        <div className={styles.actions}>
          <button className={styles.button} data-tone="warning" data-onboarding-id="settings-restart-brain-button" type="button">
            <Icons.RefreshCw size={16} />
            Restart Brain
          </button>
          <button className={styles.button} data-tone="danger" data-onboarding-id="settings-kill-brain-button" type="button">
            <Icons.Power size={16} />
            Kill Brain
          </button>
        </div>
      </div>
    </div>
  );
}
