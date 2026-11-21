import {AppWindow} from '../../agentbuddy-ui/chrome/AppWindow';
import {SettingsSurface} from '../../agentbuddy-ui/settings/SettingsSurface';
import type {SettingsSurfaceState} from '../../agentbuddy-ui/settings/settingsTypes';
import {SurfaceFrame} from '../../film/SurfaceFrame';
import {useAppWindowLayout} from '../../film/appWindowLayout';
import {
  settingsActionsPluginState,
  settingsApplicationState,
  settingsBrainPluginState,
  settingsCodePluginState,
  settingsDatabasePluginState,
  settingsFlowsPluginState,
  settingsHelpState,
  settingsJsonState,
  settingsLibraryPluginState,
  settingsLogsPluginState,
  settingsNotesPluginState,
  settingsPersonalState,
  settingsPluginsState,
  settingsPromptsPluginState,
  settingsProjectsState,
  settingsProvidersState,
  settingsThreadsPluginState,
} from '../../film/state/settings';

function SettingsDemoWindow({state}: {state: SettingsSurfaceState}) {
  const layout = useAppWindowLayout({hasRightRail: false});
  return (
    <SurfaceFrame>
      <AppWindow activePlugin="settings" breadcrumbs={['SETTINGS']} composer={false} layout={layout}>
        <SettingsSurface state={state} />
      </AppWindow>
    </SurfaceFrame>
  );
}

export const SettingsApplicationDemo = () => <SettingsDemoWindow state={settingsApplicationState} />;
export const SettingsProvidersDemo = () => <SettingsDemoWindow state={settingsProvidersState} />;
export const SettingsProjectsDemo = () => <SettingsDemoWindow state={settingsProjectsState} />;
export const SettingsPersonalDemo = () => <SettingsDemoWindow state={settingsPersonalState} />;
export const SettingsJsonDemo = () => <SettingsDemoWindow state={settingsJsonState} />;
export const SettingsPluginsDemo = () => <SettingsDemoWindow state={settingsPluginsState} />;
export const SettingsCodePluginDemo = () => <SettingsDemoWindow state={settingsCodePluginState} />;
export const SettingsDatabasePluginDemo = () => <SettingsDemoWindow state={settingsDatabasePluginState} />;
export const SettingsFlowsPluginDemo = () => <SettingsDemoWindow state={settingsFlowsPluginState} />;
export const SettingsLibraryPluginDemo = () => <SettingsDemoWindow state={settingsLibraryPluginState} />;
export const SettingsLogsPluginDemo = () => <SettingsDemoWindow state={settingsLogsPluginState} />;
export const SettingsBrainPluginDemo = () => <SettingsDemoWindow state={settingsBrainPluginState} />;
export const SettingsNotesPluginDemo = () => <SettingsDemoWindow state={settingsNotesPluginState} />;
export const SettingsActionsPluginDemo = () => <SettingsDemoWindow state={settingsActionsPluginState} />;
export const SettingsPromptsPluginDemo = () => <SettingsDemoWindow state={settingsPromptsPluginState} />;
export const SettingsThreadsPluginDemo = () => <SettingsDemoWindow state={settingsThreadsPluginState} />;
export const SettingsHelpDemo = () => <SettingsDemoWindow state={settingsHelpState} />;
