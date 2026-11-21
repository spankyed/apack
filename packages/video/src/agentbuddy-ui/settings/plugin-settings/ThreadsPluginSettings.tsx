import {Icons} from '../../primitives/Icon';
import {CollapsiblePluginSection} from './CollapsiblePluginSection';
import type {SettingsSurfaceState, ThreadModeSettings} from '../settingsTypes';
import './ThreadsPluginSettings.module.css';
import {makeStyles} from '../../primitives/makeStyles';

const styles = makeStyles('ThreadsPluginSettings');

type ThreadsSettings = NonNullable<NonNullable<SettingsSurfaceState['selectedPluginSettings']>['threads']>;

const defaultThreadsSettings: ThreadsSettings = {
  chat: {
    hotkeys: {},
    modes: [],
    quickPromptNumberKeyInserts: true,
    quickPrompts: [],
    skipRevertConfirm: false,
  },
  chatStates: [],
  clickToChat: false,
  recentThreadsLimit: 7,
  recentThreadsSortOrder: 'created',
  recordingLimitMinutes: 3,
  showOnlyRootThreads: false,
  skipArchiveConfirm: false,
  statuses: [],
  tags: [],
};

export function ThreadsPluginSettings({settings}: {settings?: ThreadsSettings}) {
  const value = settings ?? defaultThreadsSettings;
  const visibleModes = value.chat.modes.filter(mode => !mode.hidden);
  const selectedMode = visibleModes[0];
  const defaultMode = value.chat.modes.find(mode => mode.name === value.chat.defaultMode);

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        <CollapsiblePluginSection label="Conversation">
          <div className={styles.stack}>
            <Toggle title="Skip revert confirmation" copy="Revert messages without showing a confirmation dialog" checked={value.chat.skipRevertConfirm} />
            <Toggle title="Skip archive confirmation" copy="Archive threads without showing a confirmation dialog" checked={value.skipArchiveConfirm} />
            <Toggle title="Insert quick prompt on number key" copy="Pressing a number key inserts the prompt into the chat instead of copying to clipboard" checked={value.chat.quickPromptNumberKeyInserts} />
          </div>
        </CollapsiblePluginSection>

        <CollapsiblePluginSection label="Chat Modes">
          <p className={styles.copy}>Configure different conversation modes for the AI agent</p>
          <div className={styles.stack}>
            {value.chat.modes.map(mode => <ModeRow key={mode.id} mode={mode} removeDisabled={value.chat.modes.length <= 1} />)}
            <button className={styles.addButton} type="button"><Icons.Plus size={14} />Add Mode</button>
          </div>
        </CollapsiblePluginSection>

        <CollapsiblePluginSection label="Mode Phases">
          <p className={styles.copy}>Configure phases for modes that support multiple work phases</p>
          <div className={styles.compactStack}>
            <div>
              <label className={styles.fieldLabel}>Select mode to configure phases:</label>
              <select className={styles.select} defaultValue={selectedMode?.name ?? ''}>
                {visibleModes.map(mode => <option key={mode.id} value={mode.name}>{mode.name}</option>)}
              </select>
            </div>
            {(selectedMode?.phases ?? []).map(phase => (
              <div className={styles.phaseCard} key={phase.id}>
                <div className={styles.modeRow}>
                  <span className={styles.colorSwatch} style={{backgroundColor: phase.color ?? '#737373'}} />
                  <input className={`${styles.input} ${styles.modeName}`} readOnly value={phase.name} placeholder="Phase name" />
                  <input className={`${styles.input} ${styles.flexInput}`} readOnly value={phase.description} placeholder="Description of this phase" />
                  <button className={styles.iconButton} type="button" title="Remove phase"><Icons.X size={16} /></button>
                </div>
              </div>
            ))}
            <button className={styles.addButton} type="button"><Icons.Plus size={14} />Add Phase</button>
          </div>
        </CollapsiblePluginSection>

        <CollapsiblePluginSection label="Default Mode">
          <p className={styles.copy}>Mode and phase applied when starting a new thread or launching the app.</p>
          <div className={styles.defaultRow}>
            <div className={styles.defaultColumn}>
              <label className={styles.fieldLabel}>Mode</label>
              <select className={styles.select} defaultValue={value.chat.defaultMode ?? ''}>
                <option value="">(None)</option>
                {visibleModes.filter(mode => !mode.disabled).map(mode => <option key={mode.id} value={mode.name}>{mode.name}</option>)}
              </select>
            </div>
            {(defaultMode?.phases ?? []).length > 0 ? (
              <div className={styles.defaultColumn}>
                <label className={styles.fieldLabel}>Phase</label>
                <select className={styles.select} defaultValue={value.chat.defaultPhase ?? ''}>
                  <option value="">(Use first phase)</option>
                  {(defaultMode?.phases ?? []).map(phase => <option key={phase.id} value={phase.name}>{phase.name}</option>)}
                </select>
              </div>
            ) : null}
          </div>
        </CollapsiblePluginSection>

        <CollapsiblePluginSection label="Quick Prompts">
          <p className={styles.copy}>Short reusable prompts that can be quickly inserted into the chat input</p>
          <div className={styles.compactStack}>
            {value.chat.quickPrompts.map(prompt => (
              <div className={styles.quickPromptRow} key={prompt.id}>
                <textarea className={styles.textarea} readOnly value={prompt.text} rows={1} placeholder="Prompt text" />
                <button className={styles.iconButton} type="button" title="Remove prompt"><Icons.X size={16} /></button>
              </div>
            ))}
            <button className={styles.addButton} type="button"><Icons.Plus size={14} />Add Prompt</button>
          </div>
        </CollapsiblePluginSection>

        <CollapsiblePluginSection label="Agent Hotkeys">
          <p className={styles.copy}>Keyboard shortcuts available when the agent plugin is active</p>
          <div className={styles.stack}>
            <Hotkey label="Text to Speech" value={value.chat.hotkeys.textToSpeech} copy="Convert agent responses to speech (currently a stub feature)" />
            <Hotkey label="Switch Mode" value={value.chat.hotkeys.switchMode} copy="Cycle through available chat modes" />
          </div>
        </CollapsiblePluginSection>
      </div>

      <CollapsiblePluginSection label="Thread Statuses">
        <p className={styles.copy}>Manage the status options available for threads</p>
        <OptionsList items={value.statuses} addLabel="Add Status" placeholder="Status label" field="label" />
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Thread Tags">
        <p className={styles.copy}>Manage the tags available for organizing threads</p>
        <OptionsList items={value.tags} addLabel="Add Tag" placeholder="Tag name" field="name" />
      </CollapsiblePluginSection>

      <CollapsiblePluginSection label="Chat State Indicators" defaultOpen={false}>
        <p className={styles.copy}>Customize the colors and labels for chat activity states</p>
        <div className={styles.compactStack}>
          {value.chatStates.map(chatState => (
            <div className={styles.optionRow} key={chatState.id}>
              <span className={styles.colorSwatch} style={{backgroundColor: chatState.color}} />
              <input className={`${styles.input} ${styles.flexInput}`} readOnly value={chatState.label} />
              <button className={styles.busyButton} data-active={Boolean(chatState.busy)} type="button">✦</button>
              <span className={styles.stateId}>{chatState.id}</span>
            </div>
          ))}
        </div>
      </CollapsiblePluginSection>

      <Divider>
        <CollapsiblePluginSection label="Display Options">
          <p className={styles.copy}>Configure how threads are displayed in the list</p>
          <div className={styles.stack}>
            <StartToggle title="Show only root threads" copy="When enabled, only threads without parent threads will be shown in the main list. Child threads will still be accessible from their parent threads." checked={value.showOnlyRootThreads} />
            <StartToggle title="Click to open chat" copy="When enabled, clicking a thread row opens the chat view instead of the detail view." checked={value.clickToChat} />
            <NumberStart title="Recent threads shown" copy="How many recent threads appear in the quick-pick list above the chat input. Scrolls past the visible area when the list is long." value={value.recentThreadsLimit} />
            <SelectStart title="Recent threads sort order" copy="How to sort the recent threads list: by creation time, last visited, or most recent message." value={value.recentThreadsSortOrder} />
            <NumberStart title="Voice input limit (minutes)" copy="Maximum duration for a single voice input session. Recording auto-stops when the limit is reached." value={value.recordingLimitMinutes} />
          </div>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Import Threads">
          <p className={styles.copy}>Import threads from an export folder</p>
          <button className={styles.secondaryButton} type="button"><Icons.Upload size={16} />Select Export Folder...</button>
        </CollapsiblePluginSection>
      </Divider>

      <Divider>
        <CollapsiblePluginSection label="Export Threads" defaultOpen={false}>
          <p className={styles.copy}>Export all threads with messages and relations to a JSON file</p>
          <div className={styles.stack}>
            <div className={styles.directoryRow}>
              <input className={`${styles.input} ${styles.directoryInput}`} readOnly value={value.exportDirectory ?? ''} placeholder="Select output directory..." />
              <button className={styles.secondaryButton} type="button"><Icons.FolderOpen size={16} />Browse</button>
            </div>
            <button className={styles.secondaryButton} type="button"><Icons.Download size={16} />Export</button>
          </div>
        </CollapsiblePluginSection>
      </Divider>
    </div>
  );
}

function ModeRow({mode, removeDisabled}: {mode: ThreadModeSettings; removeDisabled: boolean}) {
  const VisibilityIcon = mode.disabled ? Icons.EyeOff : Icons.Eye;
  return (
    <div className={styles.modeRow}>
      <input className={`${styles.input} ${styles.modeName}`} readOnly value={mode.name} placeholder="Mode name" />
      <input className={`${styles.input} ${styles.flexInput}`} readOnly value={mode.description} placeholder="Description of this mode" />
      <button className={styles.iconButton} type="button" title={mode.disabled ? 'Enable mode' : 'Disable mode'}><VisibilityIcon size={16} /></button>
      <button className={styles.iconButton} disabled={removeDisabled} type="button" title="Remove mode"><Icons.X size={16} /></button>
    </div>
  );
}

function OptionsList({addLabel, field, items, placeholder}: {addLabel: string; field: 'label' | 'name'; items: ThreadsSettings['statuses']; placeholder: string}) {
  return (
    <div className={styles.compactStack}>
      {items.map((item, index) => (
        <div className={styles.optionRow} key={`${item.color}-${index}`}>
          <span className={styles.colorSwatch} style={{backgroundColor: item.color}} />
          <input className={`${styles.input} ${styles.flexInput}`} readOnly value={(field === 'label' ? item.label : item.name) ?? ''} placeholder={placeholder} />
          <button className={styles.iconButton} disabled={items.length <= 1} type="button" title="Remove"><Icons.X size={16} /></button>
        </div>
      ))}
      <button className={styles.addButton} type="button"><Icons.Plus size={14} />{addLabel}</button>
    </div>
  );
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

function StartToggle({checked, copy, title}: {checked: boolean; copy: string; title: string}) {
  return (
    <div className={styles.startRow}>
      <input className={styles.checkbox} readOnly checked={checked} type="checkbox" />
      <div>
        <div className={styles.label}>{title}</div>
        <p className={styles.help}>{copy}</p>
      </div>
    </div>
  );
}

function NumberStart({copy, title, value}: {copy: string; title: string; value: number}) {
  return (
    <div className={styles.startRow}>
          <input className={styles.number} readOnly type="number" value={value} />
      <div>
        <div className={styles.label}>{title}</div>
        <p className={styles.help}>{copy}</p>
      </div>
    </div>
  );
}

function SelectStart({copy, title, value}: {copy: string; title: string; value: ThreadsSettings['recentThreadsSortOrder']}) {
  return (
    <div className={styles.startRow}>
      <select className={styles.compactSelect} defaultValue={value}>
        <option value="created">Recently created</option>
        <option value="visited">Recently visited</option>
        <option value="message">Recent message</option>
      </select>
      <div>
        <div className={styles.label}>{title}</div>
        <p className={styles.help}>{copy}</p>
      </div>
    </div>
  );
}

function Hotkey({copy, label, value}: {copy: string; label: string; value?: string}) {
  return (
    <div>
      <label className={styles.fieldLabel}>{label}</label>
      <input className={styles.hotkeyInput} readOnly value={value ?? ''} placeholder="Not set" />
      <p className={styles.help}>{copy}</p>
    </div>
  );
}

function Divider({children}: {children: React.ReactNode}) {
  return <div className={styles.divider}>{children}</div>;
}
