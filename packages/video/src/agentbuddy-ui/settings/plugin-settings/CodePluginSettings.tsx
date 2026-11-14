import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import {CodeDirectorySelect} from './CodeDirectorySelect';
import type {SettingsSurfaceState} from '../settingsTypes';
import './CodePluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('CodePluginSettings');

type CodeSettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['code']>;

const defaultCodeSettings: CodeSettings = {
  autoFetchIntervalSeconds: 180,
  autoFetchRemote: false,
  closeTerminalOnTabClose: true,
  confirmTerminalClose: true,
  enablePreview: true,
  enableShellIntegration: true,
  hotkeys: {},
  maxTerminals: 25,
  mdEditorDefault: false,
  restoreTerminals: true,
  showCommits: true,
  showStashes: false,
  showWorktrees: false,
  terminalScripts: [],
};

export function CodePluginSettings({settings, projects = []}: {settings?: CodeSettings; projects?: SettingsSurfaceState['projects']}) {
  const value = settings ?? defaultCodeSettings;
  const directoryOptions = projects.flatMap(project => project.directories.map(directory => ({project: project.name, directory})));

  return (
    <div className={styles.root}>
      <CollapsiblePluginSection label="Default Base Directory">
        <p className={styles.copy}>Configure which project directory the code editor opens to on startup</p>
        <div className={styles.compactStack}>
          <div className={styles.labelRow}>
            <span className={styles.label}>Default Base Directory</span>
            <button className={styles.linkButton} type="button">Go to Projects →</button>
          </div>
          <CodeDirectorySelect disabled={directoryOptions.length === 0} value={value.defaultBaseDirectory ?? null} />
          <p className={styles.help}>
            {directoryOptions.length === 0
              ? 'Add projects in Settings → General → Projects to set a default directory'
              : 'If set, the code editor will always open to this project on startup'}
          </p>
        </div>
      </CollapsiblePluginSection>

      <Divider>
        <CollapsiblePluginSection label="Editor Settings">
          <p className={styles.copy}>Configure editor behavior and preferences</p>
          <div className={styles.stack}>
            <Toggle title="Enable preview tabs" copy="Single-clicking a file opens it as a preview. Preview tabs are replaced when opening another file. Double-click or edit to keep." checked={value.enablePreview} />
            <Toggle title="Use rich text editor for Markdown files" copy="Open .md files in the Tiptap rich text editor by default instead of the Monaco code editor" checked={value.mdEditorDefault} />
          </div>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Git Settings">
          <p className={styles.copy}>Configure git remote sync behavior</p>
          <div className={styles.stack}>
            <Toggle title="Auto-fetch remote" copy="Periodically fetch from the remote to detect new commits available to pull" checked={value.autoFetchRemote} />
            {value.autoFetchRemote ? (
              <NumberSetting title="Fetch interval (seconds)" copy="How often to check the remote for new commits (minimum 60 seconds)" value={value.autoFetchIntervalSeconds} />
            ) : null}
          </div>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Commit Panel">
          <p className={styles.copy}>Choose which sections to show in the commit panel</p>
          <div className={styles.stack}>
            <Toggle title="Show commits" copy="Show the commit log section in the commit panel" checked={value.showCommits} />
            <Toggle title="Show stashes" copy="Show the stashes section in the commit panel" checked={value.showStashes} />
            <Toggle title="Show worktrees" copy="Show the worktrees section in the commit panel" checked={value.showWorktrees} />
          </div>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Terminal Settings">
          <p className={styles.copy}>Configure terminal behavior and preferences</p>
          <div className={styles.stack}>
            <Toggle title="Restore terminals on startup" copy="Automatically restore previously opened terminals when the application starts" checked={value.restoreTerminals} />
            <Toggle title="Enable shell integration" copy="Track directory changes automatically (displays a brief setup command on terminal startup)" checked={value.enableShellIntegration} />
            <Toggle title="Confirm before closing terminals" copy="Show a confirmation prompt when closing terminal tabs" checked={value.confirmTerminalClose} />
            <Toggle title="Close terminal process when tab is closed" copy="Terminate the terminal process when closing a terminal tab" checked={value.closeTerminalOnTabClose} />
            <NumberSetting title="Maximum terminals" copy="Maximum number of terminals that can be open at once" value={value.maxTerminals} checkbox />
          </div>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Terminal Scripts">
          <p className={styles.copy}>Saved commands that can be run in new terminals via the ▶ button in the terminal header</p>
          <div className={styles.compactStack}>
            {value.terminalScripts.map(script => (
              <div className={styles.scriptRow} key={script.id}>
                <input className={styles.scriptLabel} readOnly value={script.label} />
                <input className={styles.scriptCommand} readOnly value={script.command} />
                <button className={styles.iconButton} type="button" title="Remove script"><Icons.X size={16} /></button>
              </div>
            ))}
            <div className={styles.scriptRow}>
              <input className={styles.scriptLabel} readOnly placeholder="Label" />
              <input className={styles.scriptCommand} readOnly placeholder="Command" />
              <button className={styles.iconButton} disabled type="button" title="Add script"><Icons.Plus size={16} /></button>
            </div>
          </div>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Code Hotkeys">
          <p className={styles.copy}>Keyboard shortcuts available when the code plugin is active</p>
          <div className={styles.stack}>
            <Hotkey label="Open Terminal" value={value.hotkeys.openTerminal} copy="Open a new terminal in the current working directory" />
            <Hotkey label="Open Terminal Tab" value={value.hotkeys.openTerminalTab} copy="Open a new terminal as an editor tab" />
            <Hotkey label="Focus Search" value={value.hotkeys.focusSearch} copy="Open the search panel and focus the search input" />
            <div>
              <div className={styles.hotkeyPair}>
                <Hotkey label="Previous Panel" value={value.hotkeys.navigatePrevPanel} />
                <Hotkey label="Next Panel" value={value.hotkeys.navigateNextPanel} />
              </div>
              <p className={styles.help}>Navigate between panels in the code view</p>
            </div>
          </div>
        </CollapsiblePluginSection>
      </Divider>
    </div>
  );
}

function Divider({children}: {children: React.ReactNode}) {
  return <div className={styles.divider}>{children}</div>;
}

function Toggle({checked, copy, title}: {checked: boolean; copy: string; title: string}) {
  return (
    <div className={styles.settingRow}>
      <div>
        <div className={styles.label}>{title}</div>
        <p className={styles.help}>{copy}</p>
      </div>
      <input className={styles.checkbox} readOnly checked={checked} type="checkbox" />
    </div>
  );
}

function NumberSetting({checkbox = false, copy, title, value}: {checkbox?: boolean; copy: string; title: string; value: number}) {
  return (
    <div className={styles.settingRow}>
      <div>
        <div className={styles.label}>{title}</div>
        <p className={styles.help}>{copy}</p>
      </div>
      <div className={styles.scriptRow}>
        {value > 0 ? <input className={styles.input} readOnly type="number" value={value} /> : <span className={styles.help}>No limit</span>}
        {checkbox ? <input className={styles.checkbox} readOnly checked={value > 0} type="checkbox" title="Toggle terminal limit" /> : null}
      </div>
    </div>
  );
}

function Hotkey({copy, label, value}: {copy?: string; label: string; value?: string}) {
  return (
    <div className={styles.hotkeyGroup}>
      <span className={styles.hotkeyLabel}>{label}</span>
      <input className={styles.hotkeyInput} readOnly value={value ?? ''} placeholder="Not set" />
      {copy ? <p className={styles.help}>{copy}</p> : null}
    </div>
  );
}
