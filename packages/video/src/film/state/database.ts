import type {DatabaseSurfaceState, QueryExample} from '../../agentbuddy-ui/database/databaseTypes';

const queryExamples: QueryExample[] = [
  {
    title: 'Recent Messages',
    description: 'Get messages ordered by timestamp',
    query: "return qx(EARS.Entity.Message).orderBy('timestamp', 'desc').limit(10).pick(['text', 'sender', 'timestamp']);",
  },
  {
    title: 'Active Threads',
    description: 'Get active threads',
    query: "return qx(EARS.Entity.Thread).where('status', 'active').limit(5).pickAll();",
  },
  {
    title: 'Thread Messages',
    description: 'Get messages contained in a specific thread',
    query: "const threadId = qx(EARS.Entity.Thread).first();\nreturn qx(threadId).linksTo('contains', EARS.Entity.Message).pick(['text', 'sender', 'timestamp']);",
  },
  {
    title: 'Flows with Node Counts',
    description: 'List flows with the number of nodes in each',
    query: "return qx(EARS.Entity.Flow).pick(['label', 'description']).map(f => ({\n  ...f,\n  nodeCount: qx(f.id).linksTo('contains', EARS.Entity.Node).count()\n}));",
  },
];

export const databaseSurfaceState: DatabaseSurfaceState = {
  activeMode: 'query',
  aiPrompt: '',
  currentQuery: `return qx(EARS.Entity.Thread)
  .where('status', 'active')
  .orderBy('updatedAt', 'desc')
  .limit(5)
  .pick(['topic', 'status', 'updatedAt']);`,
  error: null,
  examples: queryExamples,
  executionTime: 42.18,
  expandedSchemaCategoryIds: ['entities', 'attributes', 'relations'],
  isAiPromptOpen: false,
  isAiQueryLoading: false,
  isLoading: false,
  mode: 'query',
  queryResult: [
    {id: 'thread-launch-film', status: 'active', topic: 'AgentBuddy launch film', updatedAt: '2026-05-25T14:18:22Z'},
    {id: 'thread-release-plan', status: 'active', topic: 'Release checklist', updatedAt: '2026-05-25T13:42:09Z'},
    {id: 'thread-pr-review', status: 'active', topic: 'PR review surface', updatedAt: '2026-05-25T12:57:44Z'},
    {id: 'thread-demo-script', status: 'active', topic: 'Demo script polish', updatedAt: '2026-05-25T12:11:03Z'},
  ],
  schema: {
    attributes: [
      {kind: 'topic'},
      {kind: 'status'},
      {kind: 'updatedAt'},
      {kind: 'sender'},
      {kind: 'text'},
      {kind: 'label'},
    ],
    entities: [
      {type: 'Thread'},
      {type: 'Message'},
      {type: 'Note'},
      {type: 'Flow'},
      {type: 'Action'},
      {type: 'Prompt'},
    ],
    relations: [
      {kind: 'contains'},
      {kind: 'parent_of'},
      {kind: 'references'},
      {kind: 'created_by'},
    ],
  },
  searchQuery: '',
  selectedSchemaItemId: 'entity:Thread',
  successMessage: 'Query executed successfully',
};

export const databaseExamplesState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  activeMode: 'examples',
};

export const databaseAiLoadingState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  aiPrompt: 'Show the five most active launch threads',
  isAiPromptOpen: false,
  isAiQueryLoading: true,
  queryResult: null,
  successMessage: '',
};

export const databaseBackupExportState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  backup: {
    activeTab: 'export',
    backupName: 'agentbuddy-launch-film',
    exportPath: '/Users/spankyed/Documents/AgentBuddy Backups',
    selectedDatabases: [
      {description: 'Core application data (ears-db)', id: 'lmdb', label: 'Main Database', selected: true, tone: 'blue'},
      {description: 'Execution traces (ears-trace)', id: 'volatileLmdb', label: 'Trace Database', selected: true, tone: 'green'},
      {description: 'API keys and credentials', id: 'secretsLmdb', label: 'Secrets Database', selected: false, tone: 'amber'},
    ],
  },
  viewMode: 'backup',
};

export const databaseBackupImportState: DatabaseSurfaceState = {
  ...databaseBackupExportState,
  backup: {
    ...databaseBackupExportState.backup!,
    activeTab: 'import',
    backupInfo: {
      databases: ['lmdb', 'volatileLmdb', 'secretsLmdb'],
      hasMedia: false,
      size: 47 * 1024 * 1024,
      timestamp: 1769448640000,
    },
    importPath: '/Users/spankyed/Documents/AgentBuddy Backups/agentbuddy-launch-film',
  },
};

export const databaseTraceState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  trace: {
    currentFlowId: 'flow-release-automation',
    events: [
      {
        id: 'trace-event-1',
        label: 'Release automation',
        metadata: {trigger: 'code.branch.published', branch: 'as/react-launch-film'},
        nodeType: 'event',
        startedAt: '10:34 AM',
        status: 'completed',
        subtype: 'listener',
      },
      {
        children: [
          {
            id: 'trace-event-2a',
            label: 'Create PR summary',
            metadata: {provider: 'codex', tokens: 1842},
            nodeType: 'step',
            startedAt: '10:35 AM',
            status: 'completed',
            subtype: 'action',
          },
        ],
        id: 'trace-event-2',
        label: 'Publish launch workflow',
        metadata: {flowId: 'release-automation', result: 'ready'},
        nodeType: 'flow',
        startedAt: '10:35 AM',
        status: 'active',
        subtype: 'flow',
      },
    ],
    flows: [
      {completedAt: '42.18ms', id: 'flow-release-automation', label: 'Release automation', startedAt: '10:34 AM', status: 'active'},
      {completedAt: '1.4s', id: 'flow-onboarding', label: 'Start Onboarding', startedAt: '10:18 AM', status: 'completed'},
      {completedAt: '812ms', id: 'flow-asset-check', label: 'Asset checks', startedAt: '9:57 AM', status: 'completed'},
    ],
    hasMore: true,
  },
  viewMode: 'trace',
};

export function databaseSurfaceStateForFrame(frame: number): DatabaseSurfaceState {
  if (frame < 80) return databaseExamplesState;
  if (frame < 130) return {...databaseSurfaceState, aiPrompt: 'Show the five most active launch threads', isAiPromptOpen: true, queryResult: null, successMessage: ''};
  if (frame < 160) return databaseAiLoadingState;
  return databaseSurfaceState;
}
