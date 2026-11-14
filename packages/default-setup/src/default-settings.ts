import type { SettingsData } from '../defs/action-defs'

const settings: SettingsData = {
  general: {
    personal: {},
    secrets: {
      google: null,
      anthropic: null,
      openai: null,
      groq: null,
      mistral: null,
      cohere: null,
      custom: {},
      required: ['openai', 'anthropic'],
      cliPaths: {
        'copilot': '',
        'claude-code': '',
        'codex': '',
        'gh': '',
      },
    },
    application: {
      hotkeys: {
        switchPluginUp: {
          key: 'ArrowUp',
          modifiers: ['cmd', 'option']
        },
        switchPluginDown: {
          key: 'ArrowDown',
          modifiers: ['cmd', 'option']
        },
        toggleInspectionPanel: {
          key: 'b',
          modifiers: ['cmd']
        }
      },
      openLinksInApp: true
    },
    projects: []
  },
  plugins: {
    _meta: {
      visibility: {
        threads: true,
        code: true,
        library: false,
        flows: false,
        actions: false,
        prompts: false,
        brain: false,
        database: false,
        logs: false,
        browser: false,
        notes: false,
        settings: true,
        // blank: false,
      }
    },
    code: {
      hotkeys: {
        openTerminal: { key: '`', modifiers: ['ctrl'] },
        openTerminalTab: { key: '`', modifiers: ['ctrl', 'shift'] },
        navigatePrevPanel: { key: '[', modifiers: ['cmd', 'shift'] },
        navigateNextPanel: { key: ']', modifiers: ['cmd', 'shift'] },
        focusSearch: { key: 'f', modifiers: ['cmd', 'shift'] },
        quickOpen: { key: 'p', modifiers: ['cmd'] },
        saveFile: { key: 's', modifiers: ['cmd'] },
        closeTab: { key: 'w', modifiers: ['cmd'] },
      },
      restoreTerminals: true,
      defaultBaseDirectory: null,
      baseDirectory: null,
      enableShellIntegration: false,
      confirmTerminalClose: true,
      closeTerminalOnTabClose: true,
      maxTerminals: 25,
      mdEditorDefault: true,
      enablePreview: true,
      autoFetchRemote: false,
      autoFetchIntervalSeconds: 180,
      terminalScripts: [
        { id: 'ts_default_0', label: 'Start', command: 'npm start' },
        { id: 'ts_default_1', label: 'Dev', command: 'npm run dev' },
        { id: 'ts_default_2', label: 'Build', command: 'npm run build' },
        { id: 'ts_default_3', label: 'Test', command: 'npm test' },
      ],
      showStashes: true,
      showCommits: true,
      showWorktrees: false,
    },
    database: {
      hotkeys: {
        executeQuery: { key: 'Enter', modifiers: ['cmd'] }
      }
    },
    threads: {
      chat: {
        defaultMode: 'Claude Code',
        defaultPhase: 'Plan',
        modes: [
          { id: 'birth', name: 'Birth', description: 'Assistant onboarding and setup mode', hidden: true },
          {
            id: 'claude-code',
            name: 'Claude Code',
            description: 'Claude Code agent mode',
            phases: [
              { id: 'plan', name: 'Plan', description: 'Strategic planning and task breakdown', color: '#3B82F6' },
              { id: 'edit', name: 'Edit', description: 'Implementation and development', color: '#6B7280' },
            ]
          },
          {
            id: 'codex',
            name: 'Codex',
            description: 'OpenAI Codex agent mode',
            phases: [
              { id: 'plan', name: 'Plan', description: 'Strategic planning and exploration', color: '#3B82F6' },
              { id: 'default', name: 'Default', description: 'Implementation and development', color: '#6B7280' },
            ]
          },
          { id: 'manager', name: 'Manager', description: 'Delegate tasks and coordinate agents', hidden: true },
        ],
        hotkeys: {
          textToSpeech: { key: 'r', modifiers: ['cmd'], global: true },
          quickPrompts: { key: 'd', modifiers: ['cmd'], global: true },
          closeTab: { key: 'w', modifiers: ['cmd'] },
        },
        quickPrompts: [
          { id: 'qp_1', text: 'Write a commit message' },
          { id: 'qp_2', text: 'Plan thoroughly before implementing' },  
          { id: 'qp_3', text: 'Please investigate thoroughly and report back.' },
          { id: 'qp_4', text: 'Conduct a thorough review of these changes for bugs and completeness, then report back with findings' },
          { id: 'qp_5', text: 'Cleanup the changes making making the code more succinct, simple, and maintainable.' },
          { id: 'qp_6', text: 'Summarize the conversation to a md file' },
        ],
        quickPromptNumberKeyInserts: true
      },
      statuses: [
        { label: 'Backlog', color: '#6B7280' },
        { label: 'Open', color: '#3B82F6' },
        { label: 'In Progress', color: '#F59E0B' },
        { label: 'In Review', color: '#A855F7' },
        { label: 'Done', color: '#10B981' }
      ],
      tags: [
        { name: 'High Priority', color: '#F59E0B' },
        { name: 'Low Priority', color: '#6B7280' },
        { name: 'Bug', color: '#EF4444' },
        { name: 'Feature', color: '#10B981' },
        { name: 'Enhancement', color: '#3B82F6' },
        { name: 'Documentation', color: '#6366F1' },
        { name: 'claude-code', color: '#7C3AED' },
      ],
      chatStates: [
        { id: 'idle',    label: 'Idle',    color: '#6B7280', busy: false },
        { id: 'working', label: 'Working', color: '#FACC15', busy: true },
        { id: 'paused',  label: 'Paused',  color: '#F59E0B', busy: false },
        { id: 'error',   label: 'Error',   color: '#EF4444', busy: false },
        { id: 'success', label: 'Success', color: '#10B981', busy: false },
      ],
      showOnlyRootThreads: false,
      clickToChat: true,
      recentThreadsLimit: 7,
      recentThreadsSortOrder: 'visited',
      recordingLimitMinutes: 3
    },
    prompts: {
      categories: [
        { name: 'General', color: '#6B7280' },
        { name: 'Creative', color: '#A855F7' },
        { name: 'Technical', color: '#3B82F6' },
        { name: 'Analysis', color: '#10B981' },
        { name: 'Communication', color: '#F59E0B' },
      ]
    },
    actions: {
      categories: [
        { name: 'Utility', color: '#6B7280' },
        { name: 'Data Processing', color: '#3B82F6' },
        { name: 'Integration', color: '#10B981' },
        { name: 'Automation', color: '#F59E0B' },
        { name: 'Validation', color: '#EF4444' },
      ]
    },
    library: {
      tags: [
        { name: 'Reference', color: '#3B82F6' },
        { name: 'Tutorial', color: '#10B981' },
        { name: 'Template', color: '#A855F7' },
        { name: 'Research', color: '#F59E0B' },
        { name: 'Archive', color: '#6B7280' },
        { name: 'Important', color: '#EF4444' },
      ]
    },
    flows: {
      rootFlowId: undefined,
      enableFlowPreview: true
    },
    brain: {
      runningRootFlowId: undefined,
      inspectEnabled: false,
    },
    browser: {
      showBookmarksBar: true,
    },
    notes: {
      tasklistPanelPosition: 'left',
      showCollapseIcon: true,
    },
    logs: {
      maxLogs: 1000,
      excludedSources: [],
      showAppEvents: false
    }
  },
  internal: {
    hasOnboarded: false,
    lastInteractionTimestamp: null,
    // version is overridden with APP_VERSION at load time in packages/api/src/systems/settings/defaults.ts
    version: '',
    seedHash: null,
  },
  assistant: {
    name: '',
    birthdate: null
  }
}

export default settings
