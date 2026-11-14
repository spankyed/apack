import type {PluginId} from '../chrome/Toolbar';
import type {KeyboardShortcutValue} from './general/KeyboardShortcutInput';

export type SettingsTabId = 'general' | 'plugins' | 'help';
export type GeneralSettingsNavId = 'application' | 'secrets' | 'projects' | 'personal' | 'json';

export type SettingsProjectDirectory = {
  displayPath: string;
  name: string;
  path: string;
};

export type SettingsProject = {
  color: string;
  directories: SettingsProjectDirectory[];
  name: string;
};

export type ProviderKeyState = {
  description: string;
  editing?: boolean;
  hasKey?: boolean;
  key: string;
  label: string;
  placeholder?: string;
  priority?: 'required' | 'recommended';
  pressedAction?: 'edit' | 'save' | 'delete';
  value?: string;
};

export type CliProviderSettings = {
  error?: string;
  installCmd: string;
  installHint: string;
  key: string;
  label: string;
  placeholder: string;
  status?: 'success' | 'error' | 'testing';
  value?: string;
};

export type CustomProviderKeyState = {
  hasKey?: boolean;
  id: string;
  name: string;
};

export type PluginSettingsItem = {
  id: PluginId;
  label: string;
  visible: boolean;
};

export type SettingsCategory = {
  color: string;
  name: string;
};

export type SetupPackType = 'actions' | 'prompts' | 'flows' | 'library' | 'notes' | 'settings';

export type SetupPackPreviewItem = {
  childCount?: number;
  description?: string;
  key: string;
};

export type SetupPackImportState = {
  directory?: string;
  error?: string;
  expanded?: Record<SetupPackType, boolean>;
  importMode?: 'keep-existing' | 'replace-on-collision' | 'wipe-and-replace';
  restartBrain?: boolean;
  result?: Record<Exclude<SetupPackType, 'settings'>, {created: number; skipped?: number; updated?: number}>;
  selection?: Record<SetupPackType, string[]>;
  status: 'idle' | 'previewing' | 'selecting' | 'importing' | 'success' | 'error';
  types?: Record<SetupPackType, SetupPackPreviewItem[]>;
  missing?: SetupPackType[];
};

export type ThreadModePhaseSettings = {
  color?: string;
  description: string;
  id: string;
  name: string;
};

export type ThreadModeSettings = {
  description: string;
  disabled?: boolean;
  hidden?: boolean;
  id: string;
  name: string;
  phases?: ThreadModePhaseSettings[];
};

export type ThreadOptionSettings = {
  color: string;
  label?: string;
  name?: string;
};

export type ChatStateIndicatorSettings = {
  busy?: boolean;
  color: string;
  id: string;
  label: string;
};

export type SettingsSurfaceState = {
  activeTab: SettingsTabId;
  applicationHotkeys?: {
    custom?: Array<{eventName: string; id: string; shortcut?: string}>;
    switchPluginDown?: KeyboardShortcutValue;
    switchPluginUp?: KeyboardShortcutValue;
    toggleInspectionPanel?: KeyboardShortcutValue;
  };
  faqs: Array<{answer: string; expanded?: boolean; id: string; question: string}>;
  generalNavItem: GeneralSettingsNavId;
  generalContentOffsetY?: number;
  homeDirectory?: string;
  homeDisplayName?: string;
  plugins: PluginSettingsItem[];
  customProviders?: CustomProviderKeyState[];
  providers: ProviderKeyState[];
  projects: SettingsProject[];
  saveStatus?: 'idle' | 'saving' | 'saved';
  selectedPluginId?: PluginId;
  setupPackImport?: SetupPackImportState;
  confirmingReset?: boolean;
  resetting?: boolean;
  cliProviders?: CliProviderSettings[];
  selectedPluginSettings?: {
    actions?: {
      categories: SettingsCategory[];
      exportDirectory?: string;
      exportErrors?: string[];
      exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
      exportedFilePath?: string;
      exportedItemCount?: number;
      importErrors?: string[];
      importStatus?: 'idle' | 'importing' | 'success' | 'error';
      importedCount?: number;
    };
    brain?: {
      brainIsDead?: boolean;
      inspectEnabled?: boolean;
      needsRestart?: boolean;
      runningRootFlowId?: string;
    };
    database?: {
      hotkeys: {
        executeQuery?: KeyboardShortcutValue;
      };
    };
    code?: {
      autoFetchIntervalSeconds: number;
      autoFetchRemote: boolean;
      closeTerminalOnTabClose: boolean;
      confirmTerminalClose: boolean;
      defaultBaseDirectory?: string;
      enablePreview: boolean;
      enableShellIntegration: boolean;
      hotkeys: {
        focusSearch?: KeyboardShortcutValue;
        navigateNextPanel?: KeyboardShortcutValue;
        navigatePrevPanel?: KeyboardShortcutValue;
        openTerminal?: KeyboardShortcutValue;
        openTerminalTab?: KeyboardShortcutValue;
      };
      maxTerminals: number;
      mdEditorDefault: boolean;
      restoreTerminals: boolean;
      showCommits: boolean;
      showStashes: boolean;
      showWorktrees: boolean;
      terminalScripts: Array<{command: string; id: string; label: string}>;
    };
    flows?: {
      enableFlowPreview: boolean;
      exportDirectory?: string;
      exportErrors?: string[];
      exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
      exportedFilePath?: string;
      exportedFlowCount?: number;
      flows: Array<{id: string; label: string}>;
      importErrors?: string[];
      importStatus?: 'idle' | 'importing' | 'success' | 'error';
      importedFlowNames?: string[];
      needsRestart?: boolean;
      rootFlowId?: string;
    };
    library?: {
      exportDirectory?: string;
      exportErrors?: string[];
      exportFormat: 'markdown' | 'json';
      exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
      exportedFilePath?: string;
      exportedItemCount?: number;
      importErrors?: string[];
      importStatus?: 'idle' | 'importing' | 'success' | 'error';
      importedCount?: number;
      tags: SettingsCategory[];
    };
    logs?: {
      excludedSources: string[];
      maxLogs: number;
    };
    notes?: {
      exportDirectory?: string;
      exportErrors?: string[];
      exportFormat: 'markdown' | 'json';
      exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
      exportedFilePath?: string;
      exportedItemCount?: number;
      importErrors?: string[];
      importStatus?: 'idle' | 'importing' | 'success' | 'error';
      importedCount?: number;
      tasklistPanelPosition: 'left' | 'right';
    };
    prompts?: {
      categories: SettingsCategory[];
      exportDirectory?: string;
      exportErrors?: string[];
      exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
      exportedFilePath?: string;
      exportedItemCount?: number;
      importErrors?: string[];
      importStatus?: 'idle' | 'importing' | 'success' | 'error';
      importedCount?: number;
    };
    threads?: {
      chat: {
        defaultMode?: string;
        defaultPhase?: string;
        hotkeys: {
          switchMode?: KeyboardShortcutValue;
          textToSpeech?: KeyboardShortcutValue;
        };
        modes: ThreadModeSettings[];
        quickPromptNumberKeyInserts: boolean;
        quickPrompts: Array<{id: string; text: string}>;
        skipRevertConfirm: boolean;
      };
      chatStates: ChatStateIndicatorSettings[];
      clickToChat: boolean;
      exportDirectory?: string;
      exportErrors?: string[];
      exportStatus?: 'idle' | 'exporting' | 'success' | 'error';
      exportedFilePath?: string;
      exportedThreadCount?: number;
      importErrors?: string[];
      importStatus?: 'idle' | 'importing' | 'success' | 'error';
      importedCount?: number;
      recentThreadsLimit: number;
      recentThreadsSortOrder: 'created' | 'visited' | 'message';
      recordingLimitMinutes: number;
      showOnlyRootThreads: boolean;
      skipArchiveConfirm: boolean;
      statuses: ThreadOptionSettings[];
      tags: ThreadOptionSettings[];
    };
  };
  settingsJson: string;
  user: {
    address: {
      city: string;
      country: string;
      postalCode: string;
      state: string;
      street: string;
      street2?: string;
    };
    name: string;
    phoneNumber: string;
  };
};
