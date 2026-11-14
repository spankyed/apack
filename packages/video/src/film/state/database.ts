import type {DatabaseSurfaceState, QueryExample} from '../../agentbuddy-ui/database/databaseTypes';
import {launchFilmStory} from './launchStory';
import {filmDatabaseBackupDirectory} from './paths';

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
    {id: launchFilmStory.threads.checkoutImplementation.id, status: 'active', topic: launchFilmStory.threads.checkoutImplementation.title, updatedAt: '2026-05-25T14:18:22Z'},
    {id: launchFilmStory.threads.stripePaymentIntegration.id, status: 'active', topic: launchFilmStory.threads.stripePaymentIntegration.title, updatedAt: '2026-05-25T13:42:09Z'},
    {id: launchFilmStory.threads.addDiscountCodeSupport.id, status: 'active', topic: launchFilmStory.threads.addDiscountCodeSupport.title, updatedAt: '2026-05-25T12:57:44Z'},
    {id: launchFilmStory.threads.deployChecklist.id, status: 'active', topic: launchFilmStory.threads.deployChecklist.title, updatedAt: '2026-05-25T12:11:03Z'},
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

export const databasePrimitiveArrayState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return qx(EARS.Entity.Thread)
  .where('status', 'active')
  .pluck('topic');`,
  executionTime: 6.41,
  queryResult: [
    launchFilmStory.threads.checkoutImplementation.title,
    launchFilmStory.threads.stripePaymentIntegration.title,
    launchFilmStory.threads.addDiscountCodeSupport.title,
    launchFilmStory.threads.deployChecklist.title,
  ],
};

export const databaseObjectResultState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return qx(EARS.Entity.Thread)
  .where('id', '${launchFilmStory.threads.checkoutImplementation.id}')
  .first()
  .pickAll();`,
  executionTime: 12.82,
  queryResult: {
    id: launchFilmStory.threads.checkoutImplementation.id,
    owner: launchFilmStory.author,
    priority: 'current',
    status: 'active',
    topic: launchFilmStory.threads.checkoutImplementation.title,
    updatedAt: '2026-05-25T14:18:22Z',
  },
};

export const databaseCopiedRowState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  copiedResultRowIndex: 1,
};

export const databaseSchemaNoResultsState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  expandedSchemaCategoryIds: ['entities', 'attributes', 'relations'],
  searchQuery: 'invoice',
  selectedSchemaItemId: undefined,
};

export const databaseSchemaRefreshingState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  isSchemaRefreshing: true,
};

export const databaseLoadingState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  error: null,
  executionTime: null,
  isLoading: true,
  queryResult: null,
  successMessage: '',
};

export const databaseErrorState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return qx(EARS.Entity.Thread)
  .where('missingField', 'active')
  .pick(['topic']);`,
  error: 'Unknown attribute "missingField" on entity Thread',
  executionTime: null,
  isLoading: false,
  queryResult: null,
  successMessage: '',
};

export const databaseEmptyArrayState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return qx(EARS.Entity.Thread)
  .where('status', 'archived')
  .limit(5)
  .pick(['topic', 'status']);`,
  error: null,
  executionTime: 4.7,
  queryResult: [],
  successMessage: 'Query executed successfully',
};

export const databaseAiLoadingState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  aiPrompt: 'Show the five most active checkout threads',
  isAiPromptOpen: false,
  isAiQueryLoading: true,
  queryResult: null,
  successMessage: '',
};

export const databaseAiPromptState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  aiPrompt: 'Show the five most active checkout threads',
  isAiPromptOpen: true,
  queryResult: null,
  successMessage: '',
};

export const databaseBackupExportState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  backup: {
    activeTab: 'export',
    backupName: 'supafan-checkout-flow',
    backupNamePlaceholder: 'backup-2026-05-25',
    exportPath: filmDatabaseBackupDirectory,
    exportPathPlaceholder: '~/Documents/AgentBuddy Backups',
    selectedDatabases: [
      {description: 'Core application data (ears-db)', id: 'lmdb', label: 'Main Database', selected: true, tone: 'blue'},
      {description: 'Execution traces (ears-trace)', id: 'volatileLmdb', label: 'Trace Database', selected: false, tone: 'green'},
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
    importPath: `${filmDatabaseBackupDirectory}/supafan-checkout-flow`,
  },
};

export const databaseTraceState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  trace: {
    currentFlowId: launchFilmStory.flow.id,
    events: [
      {
        id: 'trace-event-1',
        label: 'Deploy checkout',
        metadata: {trigger: 'code.branch.published', branch: launchFilmStory.branch},
        nodeType: 'event',
        startedAt: '10:34 AM',
        status: 'completed',
        subtype: 'listener',
      },
      {
        children: [
          {
            id: 'trace-event-2a',
                  label: 'Run database migrations',
            metadata: {provider: 'codex', tokens: 1842},
            nodeType: 'step',
            startedAt: '10:35 AM',
            status: 'completed',
            subtype: 'action',
          },
        ],
        id: 'trace-event-2',
        label: 'Deploy checkout workflow',
        metadata: {flowId: launchFilmStory.flow.id, result: 'ready'},
        nodeType: 'flow',
        startedAt: '10:35 AM',
        status: 'active',
        subtype: 'flow',
      },
    ],
    expandedEventIds: ['trace-event-2'],
    flows: [
      {completedAt: '42.18ms', id: launchFilmStory.flow.id, label: launchFilmStory.flow.title, startedAt: '10:34 AM', status: 'active'},
      {completedAt: '1.4s', id: 'flow-post-purchase', label: 'Post-purchase Flow', startedAt: '10:18 AM', status: 'completed'},
      {completedAt: '812ms', id: 'flow-sales-digest', label: 'Daily Digest', startedAt: '9:57 AM', status: 'completed'},
    ],
    hasMore: true,
  },
  viewMode: 'trace',
};

export const databaseGraphState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return {
  nodes: qx(EARS.Entity.Thread).limit(6).map(thread => ({
    id: thread.id,
    type: 'Thread',
    label: thread.topic,
  })),
  edges: qx().where('kind', 'references').limit(8).pickAll(),
};`,
  graph: {
    currentLayout: 'd3-force',
    edges: [
      {id: 'edge-thread-message', source: launchFilmStory.threads.checkoutImplementation.id, target: 'message-checkout-plan', type: 'contains'},
      {id: 'edge-thread-note', source: launchFilmStory.threads.checkoutImplementation.id, target: 'note-tasklist', type: 'references'},
      {id: 'edge-thread-flow', source: launchFilmStory.threads.deployChecklist.id, target: launchFilmStory.flow.id, type: 'triggers'},
      {id: 'edge-flow-action', source: launchFilmStory.flow.id, target: 'action-run-migrations', type: 'runs'},
      {id: 'edge-thread-discount', source: launchFilmStory.threads.addDiscountCodeSupport.id, target: 'service-discount', type: 'uses'},
    ],
    nodes: [
      {connections: 2, id: launchFilmStory.threads.checkoutImplementation.id, label: launchFilmStory.threads.checkoutImplementation.title, owner: launchFilmStory.author, status: 'active', type: 'Thread'},
      {connections: 1, id: 'message-checkout-plan', label: 'Plan', role: 'assistant', type: 'Message'},
      {connections: 1, id: 'note-tasklist', label: 'Tasklist', path: 'Supafan / Tasklist', type: 'Artifact'},
      {connections: 2, id: launchFilmStory.threads.deployChecklist.id, label: 'Deploy checklist', status: 'active', type: 'Thread'},
      {connections: 2, id: launchFilmStory.flow.id, label: launchFilmStory.flow.title, type: 'Flow'},
      {connections: 1, id: 'action-run-migrations', label: 'Run migrations', type: 'Node'},
      {connections: 1, id: launchFilmStory.threads.addDiscountCodeSupport.id, label: launchFilmStory.threads.addDiscountCodeSupport.title, status: 'active', type: 'Thread'},
      {connections: 1, id: 'service-discount', label: 'Discount service', type: 'Node'},
    ],
    selectedNodeId: launchFilmStory.threads.checkoutImplementation.id,
    zoomLevel: 1,
  },
  queryResult: null,
  viewMode: 'database',
};

export const databaseMessageLookupState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return qx(EARS.Entity.Message)
  .where('text', 'contains', 'deploy-checkout')
  .orderBy('timestamp', 'desc')
  .limit(1)
  .pick(['text', 'sender', 'timestamp', 'threadId']);`,
  executionTime: 9.74,
  queryResult: [
    {
      sender: 'user',
      text: launchFilmStory.command,
      threadId: launchFilmStory.threads.deployChecklist.id,
      timestamp: '2026-05-25T14:34:18Z',
    },
  ],
  selectedSchemaItemId: 'entity:Message',
  successMessage: 'Query executed successfully',
};

export const databaseMessagesBeforeDateState: DatabaseSurfaceState = {
  ...databaseSurfaceState,
  currentQuery: `return qx(EARS.Entity.Message)
  .where('timestamp', '<', '2026-05-26')
  .where('text', 'contains', 'deploy-checkout pipeline completed')
  .orderBy('timestamp', 'desc')
  .pick(['text', 'sender', 'timestamp']);`,
  executionTime: 14.33,
  queryResult: [
    {
      sender: 'assistant',
      text: 'deploy-checkout pipeline completed',
      timestamp: '2026-05-25T14:35:16Z',
    },
    {
      sender: 'user',
      text: launchFilmStory.command,
      timestamp: '2026-05-25T14:34:18Z',
    },
    {
      sender: 'assistant',
      text: 'Ran checkout migrations, validated receipt jobs, and notified #releases.',
      timestamp: '2026-05-25T14:34:03Z',
    },
  ],
  selectedSchemaItemId: 'entity:Message',
  successMessage: 'Query executed successfully',
};

export function databaseSurfaceStateForFrame(frame: number): DatabaseSurfaceState {
  if (frame < 80) return databaseExamplesState;
  if (frame < 130) return databaseAiPromptState;
  if (frame < 160) return databaseAiLoadingState;
  return databaseSurfaceState;
}
