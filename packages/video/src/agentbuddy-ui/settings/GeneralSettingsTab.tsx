import {Icons} from '../primitives/Icon';
import {ApplicationSettings} from './general/ApplicationSettings';
import {JsonSettingsEditor} from './general/JsonSettingsEditor';
import {PersonalSettings} from './general/PersonalSettings';
import {ProjectsSettings} from './general/ProjectsSettings';
import {ProvidersSettings} from './general/ProvidersSettings';
import type {GeneralSettingsNavId, SettingsSurfaceState} from './settingsTypes';
import './GeneralSettingsTab.module.css';
import {makeStyles} from '../primitives/makeStyles';
const styles = makeStyles('GeneralSettingsTab');

const navItems = [
  {id: 'application', label: 'Application', icon: Icons.Settings},
  {id: 'secrets', label: 'Providers', icon: Icons.Key},
  {id: 'projects', label: 'Projects', icon: Icons.Briefcase},
  {id: 'personal', label: 'Personal', icon: Icons.User},
] satisfies Array<{id: GeneralSettingsNavId; label: string; icon: React.ComponentType<{size?: number; className?: string}>}>;

const bottomNavItems = [
  {id: 'json', label: 'JSON', icon: Icons.FileJson},
] satisfies Array<{id: GeneralSettingsNavId; label: string; icon: React.ComponentType<{size?: number; className?: string}>}>;

function CurrentPanel({state}: {state: SettingsSurfaceState}) {
  switch (state.generalNavItem) {
    case 'application':
      return <ApplicationSettings state={state} />;
    case 'secrets':
      return <ProvidersSettings cliProviders={state.cliProviders} customProviders={state.customProviders} providers={state.providers} />;
    case 'projects':
      return <ProjectsSettings projects={state.projects} />;
    case 'personal':
      return <PersonalSettings user={state.user} />;
    case 'json':
      return <JsonSettingsEditor value={state.settingsJson} />;
    default:
      return null;
  }
}

export function GeneralSettingsTab({state}: {state: SettingsSurfaceState}) {
  return (
    <div className={styles.root}>
      <aside className={styles.nav}>
        <div className={styles.navTop}>
          {navItems.map(item => <NavButton active={state.generalNavItem === item.id} item={item} key={item.id} />)}
        </div>
        <div className={styles.navBottom}>
          {bottomNavItems.map(item => <NavButton active={state.generalNavItem === item.id} item={item} key={item.id} />)}
        </div>
      </aside>
      <main className={styles.content}>
        <div style={state.generalContentOffsetY ? {transform: `translateY(-${state.generalContentOffsetY}px)`} : undefined}>
          <CurrentPanel state={state} />
        </div>
        <SaveStatus status={state.saveStatus} />
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

function NavButton({active, item}: {
  active: boolean;
  item: {icon: React.ComponentType<{size?: number; className?: string}>; id: string; label: string};
}) {
  const Icon = item.icon;
  return <button className={styles.navButton} data-active={active} type="button"><Icon size={16} />{item.label}</button>;
}
