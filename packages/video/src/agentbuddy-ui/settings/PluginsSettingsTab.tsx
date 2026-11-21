import {Icons} from '../primitives/Icon';
import {ActionsPluginSettings} from './plugin-settings/ActionsPluginSettings';
import {BrainPluginSettings} from './plugin-settings/BrainPluginSettings';
import {CodePluginSettings} from './plugin-settings/CodePluginSettings';
import {DatabasePluginSettings} from './plugin-settings/DatabasePluginSettings';
import {FlowsPluginSettings} from './plugin-settings/FlowsPluginSettings';
import {LibraryPluginSettings} from './plugin-settings/LibraryPluginSettings';
import {LogsPluginSettings} from './plugin-settings/LogsPluginSettings';
import {NotesPluginSettings} from './plugin-settings/NotesPluginSettings';
import {PromptsPluginSettings} from './plugin-settings/PromptsPluginSettings';
import {ThreadsPluginSettings} from './plugin-settings/ThreadsPluginSettings';
import type {PluginSettingsItem, SettingsSurfaceState} from './settingsTypes';
import './PluginsSettingsTab.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('PluginsSettingsTab');

const iconByPlugin = {
  threads: Icons.Threads,
  notes: Icons.NotebookText,
  calendar: Icons.Calendar,
  code: Icons.Code2,
  library: Icons.Library,
  flows: Icons.Flows,
  actions: Icons.Play,
  prompts: Icons.Sparkle,
  browser: Icons.Globe,
  brain: Icons.Brain,
  database: Icons.Database,
  logs: Icons.Bug,
  settings: Icons.Settings,
} as const;

export function PluginsSettingsTab({state}: {state: SettingsSurfaceState}) {
  const selected = state.selectedPluginId
    ? state.plugins.find(plugin => plugin.id === state.selectedPluginId)
    : undefined;
  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        <h3 className={styles.heading}>Plugins with Settings</h3>
        {state.plugins.length === 0 ? (
          <div className={styles.noPlugins}>
            <p>No plugins have settings configured yet</p>
          </div>
        ) : (
          state.plugins.map(plugin => <PluginRow key={plugin.id} plugin={plugin} selected={selected?.id === plugin.id} />)
        )}
      </aside>
      <main className={styles.content}>
        {selected ? (
          <>
            <div className={styles.titleRow}>
              <h2 className={styles.title}>{selected.label} Settings</h2>
              {selected.id !== 'settings' ? (
                <button className={styles.goToPlugin} title="Go to plugin" type="button">
                  <Icons.ExternalLink size={16} />
                </button>
              ) : null}
            </div>
            <SelectedPluginSettings selected={selected.id} state={state} />
            <SaveStatus status={state.saveStatus} />
          </>
        ) : (
          <div className={styles.empty}><Icons.Package size={64} /><p>Select a plugin to configure its settings</p></div>
        )}
      </main>
    </div>
  );
}

function SaveStatus({status}: {status?: SettingsSurfaceState['saveStatus']}) {
  if (status === 'saving') {
    return (
      <div className={styles.saveStatus}>
        <span className={styles.savingDot} />
        Saving...
      </div>
    );
  }

  if (status === 'saved') {
    return (
      <div className={styles.saveStatus} data-status="saved">
        <Icons.CircleCheck size={12} />
        Settings saved
      </div>
    );
  }

  return null;
}

function SelectedPluginSettings({selected, state}: {selected: PluginSettingsItem['id']; state: SettingsSurfaceState}) {
  switch (selected) {
    case 'actions':
      return <ActionsPluginSettings settings={state.selectedPluginSettings?.actions} />;
    case 'brain':
      return <BrainPluginSettings settings={state.selectedPluginSettings?.brain} />;
    case 'code':
      return <CodePluginSettings homeDirectory={state.homeDirectory} homeDisplayName={state.homeDisplayName} settings={state.selectedPluginSettings?.code} projects={state.projects} />;
    case 'database':
      return <DatabasePluginSettings settings={state.selectedPluginSettings?.database} />;
    case 'flows':
      return <FlowsPluginSettings settings={state.selectedPluginSettings?.flows} />;
    case 'library':
      return <LibraryPluginSettings settings={state.selectedPluginSettings?.library} />;
    case 'logs':
      return (
        <LogsPluginSettings
          excludedSources={state.selectedPluginSettings?.logs?.excludedSources}
          maxLogs={state.selectedPluginSettings?.logs?.maxLogs}
        />
      );
    case 'notes':
      return <NotesPluginSettings settings={state.selectedPluginSettings?.notes} />;
    case 'prompts':
      return <PromptsPluginSettings settings={state.selectedPluginSettings?.prompts} />;
    case 'threads':
      return <ThreadsPluginSettings settings={state.selectedPluginSettings?.threads} />;
    default:
      return null;
  }
}

function PluginRow({plugin, selected}: {plugin: PluginSettingsItem; selected: boolean}) {
  const Icon = iconByPlugin[plugin.id];
  const VisibilityIcon = plugin.visible ? Icons.Eye : Icons.EyeOff;
  return (
    <div className={styles.pluginRow}>
      <button className={styles.pluginButton} data-active={selected} type="button"><Icon size={16} />{plugin.label}</button>
      <button
        className={styles.visibility}
        data-visible={plugin.visible}
        disabled={plugin.id === 'settings'}
        title={plugin.id === 'settings' ? 'Settings must remain visible' : plugin.visible ? 'Hide from toolbar' : 'Show in toolbar'}
        type="button"
      >
        <VisibilityIcon size={16} />
      </button>
    </div>
  );
}
