export type ToolActivityItemState = {
  durationMs?: number;
  id: string;
  outputSummary?: string;
  status: 'running' | 'ok' | 'denied' | 'error';
  summary: string;
  tool: string;
};

export type ToolActivityBlockState = {
  artifactRef?: {
    artifactId: string;
    label: string;
  };
  defaultOpen?: boolean;
  entries: ToolActivityItemState[];
  label?: string;
  phase?: string;
  state: 'streaming' | 'done' | 'error';
};

export type ThinkingBlockState = {
  content: string;
  defaultOpen?: boolean;
  label: string;
  state: 'streaming' | 'done';
};

export type ToolInputBlockState = {
  input: Record<string, unknown>;
  toolName: 'Bash' | 'Edit' | 'Write' | string;
};

export type ApprovalOptionState = {
  label: string;
  variant: 'primary' | 'secondary' | 'danger' | 'neutral';
};

export type ApprovalBlockState = {
  allowReason?: boolean;
  approveLabel?: string;
  autoAcceptOption?: boolean;
  denyLabel?: string;
  disabled?: boolean;
  options?: ApprovalOptionState[];
  reason?: string;
  reasonPlaceholder?: string;
  requireReason?: boolean;
  response?: {
    approved: boolean;
    reason?: string;
  };
};

export type ActionButtonsBlockState = {
  buttons: Array<'submit' | 'cancel'>;
  cancelLabel?: string;
  submitDisabled?: boolean;
  submitLabel?: string;
  submitVariant?: 'primary' | 'success' | 'danger';
};

export type ChoiceOptionState = {
  description?: string;
  id: string;
  label: string;
};

export type ChoiceBlockState = {
  allowCustom?: boolean;
  choices: ChoiceOptionState[];
  compact?: boolean;
  customPlaceholder?: string;
  disabled?: boolean;
  displayText?: string;
  multiSelect?: boolean;
  response?: string | string[];
  selectedIds?: string[];
  skipOption?: {
    id: string;
    label: string;
  };
};

export type PromptBlockState = {
  content: string;
};

export type NoteBlockState = {
  content: string;
  label?: string;
  variant?: 'info' | 'warning' | 'error' | 'success';
};

export type MarkdownBlockState = {
  content: string;
  label?: string;
};

export type ToggleState = {
  default?: boolean;
  description?: string;
  id: string;
  label: string;
};

export type TogglesBlockState = {
  disabled?: boolean;
  response?: Record<string, boolean>;
  toggles: ToggleState[];
};

export type SessionListBlockState = {
  sessions: Array<{
    id: string;
    modifiedAt: string;
    size: number;
    title: string;
  }>;
};

export type LinkBlockState = {
  links: Array<{
    icon?: 'external-link' | 'file-text' | 'message-square' | 'settings' | 'link';
    label: string;
  }>;
};

export type ContextUsageBlockState = {
  categories: Array<{
    name: string;
    percentage: number;
    tokens: number;
  }>;
  maxTokens: number;
  memoryFiles?: Array<{
    path: string;
    tokens: number;
    type: string;
  }>;
  model: string;
  percentage: number;
  skills?: Array<{
    name: string;
    source: string;
    tokens: number;
  }>;
  totalTokens: number;
};

export type TextInputBlockState = {
  disabled?: boolean;
  displayText?: string;
  multiline?: boolean;
  placeholder?: string;
  response?: string;
  rows?: number;
  suggestions?: string[];
  value?: string;
};

export type FilePickerBlockState = {
  allowMultiple?: boolean;
  disabled?: boolean;
  displayText?: string;
  fileType?: 'file' | 'directory' | 'both';
  response?: string | string[];
  selectedPaths?: string[];
};

export type ProjectSelectBlockState = {
  disabled?: boolean;
  displayText?: string;
  projects: Array<{
    color: string;
    directories: string[];
    name: string;
  }>;
  response?: string;
};

export type QuestionBlockState = {
  customPlaceholder?: string;
  currentStep?: number;
  disabled?: boolean;
  response?: string | Record<string, string>;
  questions: Array<{
    allowCustom?: boolean;
    multiSelect?: boolean;
    options: ChoiceOptionState[];
    question: string;
  }>;
  selectedIds?: string[];
};

export type ButtonGroupBlockState = {
  buttons: Array<{
    id: string;
    label: string;
    state?: string;
    variant?: 'primary' | 'secondary' | 'success' | 'danger';
  }>;
  disabled?: boolean;
  displayText?: string;
  keepInteractive?: boolean;
  response?: {
    buttonId: string;
    state?: string;
  };
};

export type PlanArtifactState = {
  content: {
    branch?: string;
    notes: string;
    prNumber?: string;
    status: 'draft' | 'approved' | 'in-progress' | 'completed' | 'rejected';
    steps?: Array<{
      description?: string;
      id: string;
      status: string;
      title: string;
    }>;
  };
  id: string;
  title: string;
};

export type ThreadsHeaderState = {
  activeFilterCount?: number;
  activeView?: 'list' | 'kanban' | 'dashboard';
  filterPopover?: {
    chatStates?: Array<{color?: string; label: string; selected?: boolean}>;
    rootOnly?: boolean;
    showArchived?: boolean;
    statuses?: Array<{color?: string; label: string; selected?: boolean}>;
    tags?: Array<{color?: string; label: string; selected?: boolean}>;
    visible: boolean;
  };
  filterLabel: string;
  newThreadLabel: string;
  searchKeyword?: string;
  searchPlaceholder: string;
  showArchived?: boolean;
  subtitle: string;
};

export type KanbanCardState = {
  tags?: string[];
  title: string;
};

export type KanbanColumnState = {
  cards: KanbanCardState[];
  count?: number;
  title: string;
  tone?: 'neutral' | 'blue' | 'emerald';
};

export type KanbanBoardState = {
  columns: KanbanColumnState[];
};
