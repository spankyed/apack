import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import './BrainPluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('BrainPluginSettings');

export function BrainPluginSettings() {
  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Brain Status">
        <div className={styles.card}>
          <div className={styles.statusRow}>
            <Icons.CircleCheck size={20} color="rgb(34 197 94)" />
            <div>
              <div className={styles.statusTitle}>Brain Running</div>
              <p className={styles.statusCopy}>The brain system is active and executing the current root flow.</p>
            </div>
          </div>
          <div className={styles.lowerBlock}>
            <p className={styles.caution}>Caution: this will stop everything that's currently running.</p>
            <div className={styles.actions}>
              <button className={styles.button} data-tone="warning" type="button"><Icons.RefreshCw size={16} />Restart Brain</button>
              <button className={styles.button} data-tone="danger" type="button"><Icons.Power size={16} />Kill Brain</button>
            </div>
          </div>
        </div>
      </CollapsiblePluginSection>
      <CollapsiblePluginSection label="Inspect Mode" defaultOpen={false}>
        <p className={styles.copy} style={{marginTop: 16}}>Enable inspect mode to see detailed brain execution information in the inspection panel</p>
        <div className={styles.toggleRow}>
          <span className={styles.toggleLabel}>Inspect Mode:</span>
          <button className={styles.toggle} type="button">Disabled</button>
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}
