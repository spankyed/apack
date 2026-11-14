import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import './LogsPluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';
const styles = makeStyles('LogsPluginSettings');
const commonExclusions = ['app-events', 'xstate.*', 'debug.*', 'trace.*'];

export function LogsPluginSettings({excludedSources = ['app-events'], maxLogs = 1000}: {
  excludedSources?: string[];
  maxLogs?: number;
}) {
  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Maximum Logs">
        <div className={styles.row}>
          <span className={styles.text}>Keep the last</span>
          <input className={styles.number} readOnly value={maxLogs} />
          <span className={styles.text}>logs</span>
          <span className={styles.small}>• Older logs are automatically removed</span>
        </div>
        <input className={styles.range} readOnly type="range" min={100} max={10000} step={100} value={maxLogs} />
        <div className={styles.ticks}>
          <button type="button">100</button>
          <button type="button">500</button>
          <button type="button">1k</button>
          <button type="button">5k</button>
          <button type="button">10k</button>
        </div>
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Excluded Sources">
        <p className={styles.copy}>Hide logs from noisy sources</p>
        <div className={styles.exclusionList}>
          {excludedSources.map(source => (
            <div className={styles.exclusion} key={source}>
              <button className={styles.removeButton} title="Remove" type="button"><Icons.X size={16} /></button>
              <code className={styles.code}>{source}</code>
            </div>
          ))}
        </div>
        <div className={styles.addRow}>
          <input className={styles.input} readOnly value="" placeholder="Add pattern, e.g. debug.*" />
          <button className={styles.add} disabled type="button">Add</button>
        </div>
        <div className={styles.quick}>
          Quick filters:{' '}
          {commonExclusions.map((pattern, index) => (
            <button disabled={excludedSources.includes(pattern)} key={pattern} type="button">
              {pattern}{index < commonExclusions.length - 1 ? <span className={styles.dot}>·</span> : null}
            </button>
          ))}
        </div>
      </CollapsiblePluginSection>
    </div>
  );
}
