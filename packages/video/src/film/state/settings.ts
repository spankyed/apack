import type {SettingsSurfaceState} from '../../agentbuddy-ui/settings/settingsTypes';

const baseSettings: Omit<SettingsSurfaceState, 'activeTab' | 'generalNavItem'> = {
  faqs: [
    {answer: 'AgentBuddy stores local configuration on this device and uses it to drive workflows, plugin state, and launch-film demos.', expanded: true, id: 'faq-local', question: 'Where are settings stored?'},
    {answer: 'Providers can be configured from the General > Providers view. Keys are masked once saved.', id: 'faq-providers', question: 'How do provider keys work?'},
    {answer: 'Setup packs import compiled actions, prompts, flows, library docs, and notes.', id: 'faq-setup', question: 'What is a setup pack?'},
  ],
  plugins: [
    {id: 'threads', label: 'Threads', visible: true},
    {id: 'notes', label: 'Notes', visible: true},
    {id: 'code', label: 'Code', visible: true},
    {id: 'library', label: 'Library', visible: false},
    {id: 'flows', label: 'Flows', visible: true},
    {id: 'actions', label: 'Actions', visible: false},
    {id: 'prompts', label: 'Prompts', visible: false},
    {id: 'brain', label: 'Brain', visible: true},
    {id: 'database', label: 'Database', visible: true},
    {id: 'logs', label: 'Logs', visible: true},
    {id: 'settings', label: 'Settings', visible: true},
  ],
  customProviders: [
    {hasKey: true, id: 'clientlabs-api', name: 'Clientlabs API'},
  ],
  providers: [
    {description: 'Claude 3, Claude 2', hasKey: true, key: 'anthropic', label: 'Anthropic', placeholder: 'Enter Anthropic API key', priority: 'required'},
    {description: 'GPT-4, GPT-3.5, DALL-E', hasKey: true, key: 'openai', label: 'OpenAI', placeholder: 'Enter OpenAI API key', priority: 'required'},
    {description: 'Gemini, PaLM', hasKey: false, key: 'google', label: 'Google AI', placeholder: 'Enter Google AI API key', priority: 'recommended'},
    {description: 'Fast inference API', hasKey: false, key: 'groq', label: 'Groq', placeholder: 'Enter Groq API key'},
    {description: 'Mistral models', hasKey: false, key: 'mistral', label: 'Mistral AI', placeholder: 'Enter Mistral AI API key'},
    {description: 'Command, Embed, Rerank', hasKey: false, key: 'cohere', label: 'Cohere', placeholder: 'Enter Cohere API key'},
  ],
  projects: [
    {color: '#3b82f6', directories: ['/Users/spankyed/Develop/Projects/AgentBuddy'], name: 'AgentBuddy'},
    {color: '#22c55e', directories: ['/Users/spankyed/Develop/Projects/Clientlabs'], name: 'Clientlabs'},
    {color: '#f59e0b', directories: ['/Users/spankyed/Develop/Projects/Launch'], name: 'Launch'},
  ],
  saveStatus: 'saved',
  selectedPluginId: 'brain',
  selectedPluginSettings: {
    actions: {
      categories: [
        {name: 'database', color: '#3B82F6'},
        {name: 'communication', color: '#22C55E'},
        {name: 'utility', color: '#A855F7'},
      ],
    },
    code: {
      autoFetchIntervalSeconds: 180,
      autoFetchRemote: true,
      closeTerminalOnTabClose: true,
      confirmTerminalClose: true,
      defaultBaseDirectory: '/Users/spankyed/Develop/Projects/AgentBuddy',
      enablePreview: true,
      enableShellIntegration: true,
      hotkeys: {
        focusSearch: '⌘ ⇧ F',
        navigateNextPanel: '⌘ ]',
        navigatePrevPanel: '⌘ [',
        openTerminal: '⌃ `',
        openTerminalTab: '⌘ ⇧ `',
      },
      maxTerminals: 25,
      mdEditorDefault: false,
      restoreTerminals: true,
      showCommits: true,
      showStashes: false,
      showWorktrees: true,
      terminalScripts: [
        {id: 'dev', label: 'dev', command: 'npm run dev'},
        {id: 'verify', label: 'verify', command: 'npm run verify'},
      ],
    },
    database: {
      executeQueryShortcut: '⌘ ↵',
    },
    flows: {
      enableFlowPreview: true,
      flows: [
        {id: 'root-flow', label: 'Root Flow'},
        {id: 'launch-release', label: 'Launch Release'},
        {id: 'run-onboarding', label: 'Run Onboarding'},
      ],
      rootFlowId: 'root-flow',
    },
    library: {
      exportDirectory: '/Users/spankyed/Exports/AgentBuddy Library',
      exportFormat: 'markdown',
      tags: [
        {name: 'Reference', color: '#3B82F6'},
        {name: 'Research', color: '#22C55E'},
        {name: 'Launch', color: '#A855F7'},
      ],
    },
    logs: {
      excludedSources: ['app-events', 'debug.*'],
      maxLogs: 1000,
    },
    notes: {
      exportDirectory: '/Users/spankyed/Exports/AgentBuddy Notes',
      exportFormat: 'markdown',
      tasklistPanelPosition: 'left',
    },
    prompts: {
      categories: [
        {name: 'development', color: '#22C55E'},
        {name: 'analysis', color: '#F97316'},
        {name: 'creative', color: '#EC4899'},
      ],
    },
    threads: {
      chat: {
        defaultMode: 'Plan',
        defaultPhase: 'Research',
        hotkeys: {
          switchMode: '⌘ ⇧ M',
          textToSpeech: '⌘ ⇧ S',
        },
        modes: [
          {
            id: 'mode-codex',
            name: 'Codex',
            description: 'Code-focused agent work with repository context',
            phases: [
              {id: 'phase-plan', name: 'Plan', description: 'Think through the implementation path', color: '#60A5FA'},
              {id: 'phase-execute', name: 'Execute', description: 'Apply changes and verify behavior', color: '#34D399'},
            ],
          },
          {
            id: 'mode-plan',
            name: 'Plan',
            description: 'Break work into reviewed steps before execution',
            phases: [
              {id: 'phase-research', name: 'Research', description: 'Gather source context', color: '#A78BFA'},
              {id: 'phase-review', name: 'Review', description: 'Check risks and assumptions', color: '#F59E0B'},
            ],
          },
          {id: 'mode-chat', name: 'Chat', description: 'General conversation and lightweight help', disabled: true},
        ],
        quickPromptNumberKeyInserts: true,
        quickPrompts: [
          {id: 'qp-ship', text: 'Turn this launch plan into implementation tickets'},
          {id: 'qp-review', text: 'Review the current branch and call out fidelity gaps'},
        ],
        skipRevertConfirm: false,
      },
      chatStates: [
        {id: 'idle', label: 'Idle', color: '#737373'},
        {id: 'thinking', label: 'Thinking', color: '#A78BFA', busy: true},
        {id: 'working', label: 'Working', color: '#22C55E'},
      ],
      clickToChat: false,
      exportDirectory: '/Users/spankyed/Exports/AgentBuddy Threads',
      recentThreadsLimit: 7,
      recentThreadsSortOrder: 'visited',
      recordingLimitMinutes: 3,
      showOnlyRootThreads: false,
      skipArchiveConfirm: false,
      statuses: [
        {label: 'Backlog', color: '#737373'},
        {label: 'Active', color: '#22C55E'},
        {label: 'Blocked', color: '#F97316'},
      ],
      tags: [
        {name: 'launch', color: '#3B82F6'},
        {name: 'film', color: '#A855F7'},
        {name: 'ui', color: '#14B8A6'},
      ],
    },
  },
  settingsJson: JSON.stringify({
    general: {
      application: {hotkeys: {switchPluginDown: 'Cmd+Down', switchPluginUp: 'Cmd+Up'}},
      personal: {name: 'Spanky', phoneNumber: '(555) 120-4420'},
    },
    plugins: {_meta: {visibility: {actions: false, prompts: false}}},
  }, null, 2),
  user: {
    address: {
      city: 'Brooklyn',
      country: 'US',
      postalCode: '11211',
      state: 'NY',
      street: '120 Kent Ave',
      street2: 'Suite 4',
    },
    name: 'Spanky',
    phoneNumber: '(555) 120-4420',
  },
};

export const settingsApplicationState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'application',
};

export const settingsProvidersState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'secrets',
};

export const settingsProjectsState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'projects',
};

export const settingsPersonalState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'personal',
};

export const settingsJsonState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'json',
};

export const settingsPluginsState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'plugins',
  generalNavItem: 'application',
};

export const settingsDatabasePluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'database',
};

export const settingsCodePluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'code',
};

export const settingsFlowsPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'flows',
};

export const settingsLibraryPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'library',
};

export const settingsLogsPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'logs',
};

export const settingsBrainPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'brain',
};

export const settingsNotesPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'notes',
};

export const settingsActionsPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'actions',
};

export const settingsPromptsPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'prompts',
};

export const settingsThreadsPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'threads',
};

export const settingsHelpState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'help',
  generalNavItem: 'application',
};
