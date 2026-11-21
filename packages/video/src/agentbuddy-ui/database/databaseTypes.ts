export type DatabaseSchemaItem = {
  description?: string;
  kind?: string;
  type?: string;
};

export type DatabaseSchema = {
  attributes: DatabaseSchemaItem[];
  entities: DatabaseSchemaItem[];
  relations: DatabaseSchemaItem[];
};

export type QueryExample = {
  description: string;
  query: string;
  title: string;
};

export type DatabaseResultRow = Record<string, unknown>;
export type DatabaseQueryResult = DatabaseResultRow[] | unknown[] | Record<string, unknown> | string | number | boolean | null;

export type DatabaseBackupState = {
  activeTab: 'export' | 'import';
  backupInfo?: {
    databases: string[];
    hasMedia?: boolean;
    size: number;
    timestamp: number;
  };
  backupName: string;
  backupNamePlaceholder?: string;
  exportPath: string;
  exportPathPlaceholder?: string;
  importPath?: string;
  isProcessing?: boolean;
  selectedDatabases: Array<{
    description: string;
    id: string;
    label: string;
    selected: boolean;
    tone: 'blue' | 'green' | 'amber';
  }>;
};

export type DatabaseTraceFlow = {
  completedAt?: string;
  id: string;
  label: string;
  startedAt: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
};

export type DatabaseTraceEvent = {
  children?: DatabaseTraceEvent[];
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
  nodeType: 'flow' | 'step' | 'event';
  startedAt?: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  subtype?: string;
};

export type DatabaseTraceState = {
  currentFlowId?: string;
  events: DatabaseTraceEvent[];
  expandedEventIds?: string[];
  flows: DatabaseTraceFlow[];
  hasMore?: boolean;
  isLoading?: boolean;
};

export type DatabaseGraphNode = {
  connections?: number;
  id: string;
  label?: string;
  type?: string;
  [key: string]: unknown;
};

export type DatabaseGraphEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
};

export type DatabaseGraphState = {
  currentLayout: string;
  edges: DatabaseGraphEdge[];
  isFullscreen?: boolean;
  isLoading?: boolean;
  nodes: DatabaseGraphNode[];
  selectedNodeId?: string;
  zoomLevel: number;
};

export type DatabaseSurfaceState = {
  activeMode: 'query' | 'examples';
  aiPrompt?: string;
  backup?: DatabaseBackupState;
  copiedResultRowIndex?: number;
  currentQuery: string;
  error: string | null;
  executePressed?: boolean;
  executeQueryShortcut?: {
    key: string;
    modifiers: string[];
  };
  executionTime: number | null;
  examples: QueryExample[];
  expandedSchemaCategoryIds?: Array<'attributes' | 'entities' | 'relations'>;
  graph?: DatabaseGraphState;
  isAiPromptOpen: boolean;
  isAiQueryLoading: boolean;
  isLoading: boolean;
  isSchemaRefreshing?: boolean;
  mode: 'query' | 'transaction';
  queryResult: DatabaseQueryResult;
  schema: DatabaseSchema;
  searchQuery: string;
  selectedSchemaItemId?: string;
  successMessage: string;
  trace?: DatabaseTraceState;
  viewMode?: 'database' | 'backup' | 'trace';
};
