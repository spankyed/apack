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

export type DatabaseBackupState = {
  activeTab: 'export' | 'import';
  backupInfo?: {
    databases: string[];
    hasMedia?: boolean;
    size: number;
    timestamp: number;
  };
  backupName: string;
  exportPath: string;
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
  flows: DatabaseTraceFlow[];
  hasMore?: boolean;
  isLoading?: boolean;
};

export type DatabaseSurfaceState = {
  activeMode: 'query' | 'examples';
  aiPrompt?: string;
  backup?: DatabaseBackupState;
  currentQuery: string;
  error: string | null;
  executeQueryShortcut?: {
    key: string;
    modifiers: string[];
  };
  executionTime: number | null;
  examples: QueryExample[];
  expandedSchemaCategoryIds?: Array<'attributes' | 'entities' | 'relations'>;
  isAiPromptOpen: boolean;
  isAiQueryLoading: boolean;
  isLoading: boolean;
  mode: 'query' | 'transaction';
  queryResult: DatabaseResultRow[] | null;
  schema: DatabaseSchema;
  searchQuery: string;
  selectedSchemaItemId?: string;
  successMessage: string;
  trace?: DatabaseTraceState;
  viewMode?: 'database' | 'backup' | 'trace';
};
