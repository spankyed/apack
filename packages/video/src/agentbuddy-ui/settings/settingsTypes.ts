import type {PluginId} from '../chrome/Toolbar';

export type SettingsTabId = 'general' | 'plugins' | 'help';
export type GeneralSettingsNavId = 'application' | 'secrets' | 'projects' | 'personal' | 'json';

export type SettingsProject = {
  color: string;
  directories: string[];
  name: string;
};

export type ProviderKeyState = {
  description: string;
  hasKey?: boolean;
  key: string;
  label: string;
  placeholder?: string;
  priority?: 'required' | 'recommended';
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
  faqs: Array<{answer: string; expanded?: boolean; id: string; question: string}>;
  generalNavItem: GeneralSettingsNavId;
  plugins: PluginSettingsItem[];
  customProviders?: CustomProviderKeyState[];
  providers: ProviderKeyState[];
  projects: SettingsProject[];
  saveStatus?: 'idle' | 'saving' | 'saved';
  selectedPluginId?: PluginId;
  selectedPluginSettings?: {
    actions?: {
      categories: SettingsCategory[];
    };
    database?: {
      executeQueryShortcut: string;
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
        focusSearch?: string;
        navigateNextPanel?: string;
        navigatePrevPanel?: string;
        openTerminal?: string;
        openTerminalTab?: string;
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
      flows: Array<{id: string; label: string}>;
      rootFlowId?: string;
    };
    library?: {
      exportDirectory?: string;
      exportFormat: 'markdown' | 'json';
      tags: SettingsCategory[];
    };
    logs?: {
      excludedSources: string[];
      maxLogs: number;
    };
    notes?: {
      exportDirectory?: string;
      exportFormat: 'markdown' | 'json';
      tasklistPanelPosition: 'left' | 'right';
    };
    prompts?: {
      categories: SettingsCategory[];
    };
    threads?: {
      chat: {
        defaultMode?: string;
        defaultPhase?: string;
        hotkeys: {
          switchMode?: string;
          textToSpeech?: string;
        };
        modes: ThreadModeSettings[];
        quickPromptNumberKeyInserts: boolean;
        quickPrompts: Array<{id: string; text: string}>;
        skipRevertConfirm: boolean;
      };
      chatStates: ChatStateIndicatorSettings[];
      clickToChat: boolean;
      exportDirectory?: string;
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
