import type {SettingsProjectDirectory, SettingsSurfaceState} from '../../agentbuddy-ui/settings/settingsTypes';
import {launchFilmStory} from './launchStory';
import {filmExportDirectories, filmHomeDirectory, filmPathState, filmProjectDirectories, filmProjects, filmSetupPackDirectories, type FilmDirectoryState} from './paths';

function projectDirectory(directory: FilmDirectoryState): SettingsProjectDirectory {
  return {
    displayPath: directory.displayPath,
    name: directory.name,
    path: directory.path,
  };
}

const baseSettings: Omit<SettingsSurfaceState, 'activeTab' | 'generalNavItem'> = {
  applicationHotkeys: {
    custom: [
      {id: 'hotkey_quick_prompt', eventName: 'QUICK_PROMPT.OPEN', shortcut: '⌘ K'},
      {id: 'hotkey_checkout_context', eventName: 'CHECKOUT.CONTEXT_CAPTURE', shortcut: '⌘ ⇧ C'},
    ],
    switchPluginDown: {key: 'ArrowDown', modifiers: ['cmd']},
    switchPluginUp: {key: 'ArrowUp', modifiers: ['cmd']},
    toggleInspectionPanel: {key: 'i', modifiers: ['cmd']},
  },
  faqs: [
    {answer: 'AgentBuddy stores local configuration on this device and uses it to drive workflows, plugin state, and Supafan checkout work.', id: 'faq-local', question: 'Where are settings stored?'},
    {answer: 'Providers can be configured from the General > Providers view. Keys are masked once saved.', id: 'faq-providers', question: 'How do provider keys work?'},
    {answer: 'Setup packs import compiled actions, prompts, flows, library docs, and notes.', id: 'faq-setup', question: 'What is a setup pack?'},
  ],
  homeDirectory: filmHomeDirectory,
  homeDisplayName: filmPathState.homeDisplayName,
  plugins: [
    {id: 'threads', label: 'Threads', visible: true},
    {id: 'notes', label: 'Notes', visible: true},
    {id: 'code', label: 'Code', visible: true},
    {id: 'library', label: 'Library', visible: false},
    {id: 'flows', label: 'Flows', visible: true},
    {id: 'actions', label: 'Actions', visible: false},
    {id: 'prompts', label: 'Prompts', visible: false},
    {id: 'browser', label: 'Browser', visible: true},
    {id: 'brain', label: 'Brain', visible: true},
    {id: 'database', label: 'Database', visible: true},
    {id: 'logs', label: 'Logs', visible: true},
  ],
  customProviders: [],
  cliProviders: [
    {installCmd: 'npm install -g @github/copilot', installHint: 'Install via npm', key: 'copilot', label: 'Copilot CLI', placeholder: 'Path override (auto-detected if empty)'},
    {installCmd: 'npm install -g @anthropic-ai/claude-code', installHint: 'Install via npm', key: 'claude-code', label: 'Claude Code CLI', placeholder: 'Path override (auto-detected if empty)', status: 'success', value: '/opt/homebrew/bin/claude'},
    {installCmd: 'npm install -g @openai/codex', installHint: 'Install via npm', key: 'codex', label: 'Codex CLI', placeholder: 'Path override (auto-detected if empty)', status: 'success', value: '/opt/homebrew/bin/codex'},
    {installCmd: 'brew install gh', installHint: 'Install via Homebrew', key: 'gh', label: 'GitHub CLI', placeholder: 'Path override (auto-detected if empty)', status: 'error', error: 'CLI not found in PATH'},
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
    {color: '#3b82f6', directories: [projectDirectory(filmProjectDirectories.supafan)], name: launchFilmStory.persona.project},
    {color: '#22c55e', directories: [projectDirectory(filmProjectDirectories.launch)], name: 'Creator Tools'},
    {color: '#f59e0b', directories: [projectDirectory(filmProjectDirectories.launch)], name: 'Launch'},
  ],
  saveStatus: 'saved',
  selectedPluginId: 'brain',
  selectedPluginSettings: {
    actions: {
      exportDirectory: filmExportDirectories.actions,
      categories: [
        {name: 'database', color: '#3B82F6'},
        {name: 'communication', color: '#22C55E'},
        {name: 'utility', color: '#A855F7'},
      ],
    },
    brain: {
      brainIsDead: false,
      inspectEnabled: false,
      needsRestart: false,
      runningRootFlowId: 'root-flow',
    },
    code: {
      autoFetchIntervalSeconds: 180,
      autoFetchRemote: true,
      closeTerminalOnTabClose: true,
      confirmTerminalClose: true,
      defaultBaseDirectory: filmProjects.supafan,
      enablePreview: true,
      enableShellIntegration: true,
      hotkeys: {
        focusSearch: {key: 'f', modifiers: ['cmd', 'shift']},
        navigateNextPanel: {key: ']', modifiers: ['cmd']},
        navigatePrevPanel: {key: '[', modifiers: ['cmd']},
        openTerminal: {key: '`', modifiers: ['ctrl']},
        openTerminalTab: {key: '`', modifiers: ['cmd', 'shift']},
      },
      maxTerminals: 25,
      mdEditorDefault: false,
      restoreTerminals: true,
      showCommits: true,
      showStashes: false,
      showWorktrees: true,
      terminalScripts: [
        {id: 'dev', label: 'dev', command: 'npm run dev'},
        {id: 'checkout-tests', label: 'checkout tests', command: 'npm test -- --filter checkout'},
      ],
    },
    database: {
      hotkeys: {
        executeQuery: {key: 'Enter', modifiers: ['cmd']},
      },
    },
    flows: {
      enableFlowPreview: true,
      exportDirectory: filmExportDirectories.flows,
      flows: [
        {id: 'root-flow', label: 'Root Flow'},
        {id: launchFilmStory.flow.id, label: launchFilmStory.flow.title},
        {id: 'post-purchase-flow', label: 'Post-purchase Flow'},
      ],
      needsRestart: true,
      rootFlowId: 'root-flow',
    },
    library: {
      exportDirectory: filmExportDirectories.library,
      exportFormat: 'markdown',
      tags: [
        {name: 'Reference', color: '#3B82F6'},
        {name: 'Payments', color: '#22C55E'},
        {name: 'Checkout', color: '#A855F7'},
      ],
    },
    logs: {
      excludedSources: ['app-events', 'debug.*'],
      maxLogs: 1000,
    },
    notes: {
      exportDirectory: filmExportDirectories.notes,
      exportFormat: 'markdown',
      tasklistPanelPosition: 'left',
    },
    prompts: {
      exportDirectory: filmExportDirectories.prompts,
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
          switchMode: {key: 'm', modifiers: ['cmd', 'shift']},
          textToSpeech: {key: 's', modifiers: ['cmd', 'shift']},
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
          {id: 'qp-ship', text: 'Turn this checkout plan into implementation tickets'},
          {id: 'qp-review', text: 'Review the checkout branch and call out release blockers'},
        ],
        skipRevertConfirm: false,
      },
      chatStates: [
        {id: 'idle', label: 'Idle', color: '#737373'},
        {id: 'thinking', label: 'Thinking', color: '#A78BFA', busy: true},
        {id: 'working', label: 'Working', color: '#22C55E'},
      ],
      clickToChat: false,
      exportDirectory: filmExportDirectories.threads,
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
        {name: 'checkout', color: '#3B82F6'},
        {name: 'payments', color: '#A855F7'},
        {name: 'stripe', color: '#14B8A6'},
      ],
    },
  },
  settingsJson: JSON.stringify({
    general: {
      application: {hotkeys: {switchPluginDown: 'Cmd+Down', switchPluginUp: 'Cmd+Up'}},
      personal: {name: launchFilmStory.persona.name, phoneNumber: '(555) 120-4420'},
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
    name: launchFilmStory.persona.name,
    phoneNumber: '(555) 120-4420',
  },
};

export const settingsApplicationState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'application',
};

export const settingsSetupPackSelectingState: SettingsSurfaceState = {
  ...settingsApplicationState,
  setupPackImport: {
    directory: filmSetupPackDirectories.launch,
    expanded: {
      actions: true,
      prompts: true,
      flows: true,
      library: false,
      notes: false,
      settings: false,
    },
    importMode: 'replace-on-collision',
    restartBrain: true,
    selection: {
      actions: ['create_ticket', 'publish_branch'],
      prompts: ['checkout_release_notes'],
      flows: [launchFilmStory.flow.id],
      library: ['checkout-system'],
      notes: [],
      settings: [],
    },
    status: 'selecting',
    types: {
      actions: [
        {key: 'create_ticket', description: 'Create implementation tickets from checkout context'},
        {key: 'publish_branch', description: 'Publish and prepare branch metadata'},
      ],
      prompts: [
        {key: 'checkout_release_notes', description: 'Generate checkout-ready release notes'},
      ],
      flows: [
        {key: launchFilmStory.flow.id, childCount: 4, description: 'Supafan checkout deploy flow'},
      ],
      library: [
        {key: 'checkout-system', description: 'Checkout system reference'},
      ],
      notes: [],
      settings: [],
    },
  },
};

export const settingsSetupPackSuccessState: SettingsSurfaceState = {
  ...settingsApplicationState,
  setupPackImport: {
    result: {
      actions: {created: 2, updated: 1},
      prompts: {created: 1, updated: 0},
      flows: {created: 1, skipped: 0},
      library: {created: 1, updated: 2},
      notes: {created: 0, updated: 0},
    },
    status: 'success',
  },
};

export const settingsSetupPackPreviewingState: SettingsSurfaceState = {
  ...settingsApplicationState,
  setupPackImport: {
    directory: filmSetupPackDirectories.launch,
    status: 'previewing',
  },
};

export const settingsSetupPackErrorState: SettingsSurfaceState = {
  ...settingsApplicationState,
  setupPackImport: {
    directory: filmSetupPackDirectories.broken,
    error: 'Missing manifest.json in compiled setup pack directory',
    status: 'error',
  },
};

export const settingsResetConfirmState: SettingsSurfaceState = {
  ...settingsApplicationState,
  confirmingReset: true,
};

export const settingsResettingState: SettingsSurfaceState = {
  ...settingsApplicationState,
  confirmingReset: true,
  resetting: true,
};

export const settingsProvidersState: SettingsSurfaceState = {
  ...baseSettings,
  activeTab: 'general',
  generalNavItem: 'secrets',
};

export function settingsProvidersStateForFrame(frame: number): SettingsSurfaceState {
  const local = Math.max(0, frame - 292);
  const editing = local > 22 && local < 56;
  const value = local > 34 ? 'gemini-demo-key-••••' : local > 28 ? 'gemini-demo-key' : '';
  return {
    ...settingsProvidersState,
    generalContentOffsetY: 684,
    saveStatus: local > 64 ? 'saved' : local > 56 ? 'saving' : 'idle',
    providers: settingsProvidersState.providers.map(provider => (
      provider.key === 'google'
        ? {
            ...provider,
            editing,
            hasKey: local > 64 ? true : provider.hasKey,
            pressedAction: local > 14 && local <= 24 ? 'edit' : local > 52 && local <= 60 ? 'save' : undefined,
            value,
          }
        : provider
    )),
  };
}

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

export const settingsPluginsNoSelectionState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: undefined,
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

export const settingsBrowserPluginState: SettingsSurfaceState = {
  ...settingsPluginsState,
  selectedPluginId: 'browser',
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

export const settingsHelpExpandedState: SettingsSurfaceState = {
  ...settingsHelpState,
  faqs: baseSettings.faqs.map((faq, index) => ({...faq, expanded: index === 0})),
};
