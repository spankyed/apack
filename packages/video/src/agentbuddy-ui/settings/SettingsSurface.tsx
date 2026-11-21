import {GeneralSettingsTab} from './GeneralSettingsTab';
import {HelpSettingsTab} from './HelpSettingsTab';
import {PluginsSettingsTab} from './PluginsSettingsTab';
import type {SettingsSurfaceState, SettingsTabId} from './settingsTypes';
import './SettingsSurface.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('SettingsSurface');

const tabs: Array<{id: SettingsTabId; label: string}> = [
  {id: 'general', label: 'General'},
  {id: 'plugins', label: 'Plugins'},
  {id: 'help', label: 'Help'},
];

export function SettingsSurface({state}: {state: SettingsSurfaceState}) {
  return (
    <div className={styles.root}>
      <div className={styles.tabs}>
        {tabs.map(tab => (
          <button className={styles.tab} data-active={state.activeTab === tab.id} key={tab.id} type="button">
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {state.activeTab === 'general' ? <GeneralSettingsTab state={state} /> : null}
        {state.activeTab === 'plugins' ? <PluginsSettingsTab state={state} /> : null}
        {state.activeTab === 'help' ? <HelpSettingsTab state={state} /> : null}
      </div>
    </div>
  );
}
