import type {GitFile} from './GitFileItem';

export type CommitLogEntryState = {
  authorName?: string;
  hash: string;
  time: string;
  title: string;
};

export type WorktreeState = {
  branch: string;
  current?: boolean;
  locked?: boolean;
  main?: boolean;
  path: string;
  pressed?: boolean;
};

export type StashState = {
  branch: string;
  date: string;
  message: string;
  ref: string;
};

export type TerminalPanelState = {
  activeTerminalId?: string;
  expanded?: boolean;
  output?: string;
  terminals: Array<{
    id: string;
    shell: string;
    title: string;
  }>;
};

export type PullRequestPanelState = {
  baseBranch: string;
  body: string;
  branchPublished: boolean;
  changedFiles: GitFile[];
  checks: string[];
  comments?: PullRequestCommentState[];
  createdPr?: {
    authorName?: string;
    baseBranch?: string;
    commitCount?: number;
    createdAt?: string;
    headBranch?: string;
    isDraft?: boolean;
    mergeStateStatus?: 'CLEAN' | 'DIRTY' | 'BEHIND' | 'BLOCKED' | 'UNKNOWN';
    mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
    number: number;
    reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'REVIEWED';
    state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';
    statusCheckRollup?: PullRequestStatusCheckState[];
    url: string;
  };
  fileTree: PullRequestFileTreeNode[];
  headBranch: string;
  loadingFiles?: boolean;
  openPullRequests?: Array<{
    isDraft?: boolean;
    number: number;
    state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';
    title: string;
  }>;
  selectorOpen?: boolean;
  reviewThreads?: PullRequestReviewThreadState[];
  selectedCommentTab?: 'discussion' | 'reviews';
  showMergeTooltip?: boolean;
  title: string;
};

export type PullRequestStatusCheckState = {
  conclusion?: 'SUCCESS' | 'FAILURE' | 'CANCELLED' | 'SKIPPED' | 'TIMED_OUT' | null;
  name: string;
  state?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR';
  status?: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'PENDING' | 'REQUESTED' | null;
};

export type PullRequestCommentState = {
  authorName: string;
  body: string;
  createdAt: string;
  id: string;
  viewerDidAuthor?: boolean;
};

export type PullRequestReviewCommentState = {
  authorName: string;
  body: string;
  createdAt: string;
  id: string;
  viewerDidAuthor?: boolean;
};

export type PullRequestReviewThreadState = {
  comments: PullRequestReviewCommentState[];
  diffLines?: Array<{
    kind: 'context' | 'added' | 'removed' | 'meta';
    text: string;
  }>;
  id: string;
  isResolved?: boolean;
  location: string;
  path: string;
};

export type PullRequestFileTreeNode = {
  children?: PullRequestFileTreeNode[];
  count?: number;
  id: string;
  label: string;
  status?: GitFile['status'];
  type: 'folder' | 'file';
};

export type CodeReviewState = {
  branch: string;
  branchSync?: {
    commitsAhead?: number;
    commitsBehind?: number;
    hasUpstream?: boolean;
    syncing?: boolean;
  };
  baseDirectory: string;
  changes: GitFile[];
  commits: CommitLogEntryState[];
  diff: {
    fileName: string;
    lineStart: number;
    lines: Array<{
      kind: 'add' | 'remove' | 'context';
      text: string;
    }>;
  };
  staged: GitFile[];
  stashes?: StashState[];
  stashesExpanded?: boolean;
  stashSearchOpen?: boolean;
  stashSearchQuery?: string;
  pullRequest: PullRequestPanelState;
  terminal: TerminalPanelState;
  worktrees: WorktreeState[];
};

export type CodeReviewViewState = {
  activePanel: 'commit' | 'pr';
  commitButtonPressed?: boolean;
  commitMenuActionPressed?: boolean;
  commitMenuOpen?: boolean;
  commitMessage: string;
  diffLineOpacities: number[];
  generateCommitPressed?: boolean;
  generatingCommitMessage: boolean;
  leftSurface?: 'blank' | 'diff' | 'terminal';
  prMode: 'files' | 'create' | 'details';
  prCreatePressed?: boolean;
  prMergePressed?: boolean;
  pullRequest: PullRequestPanelState;
  prPublishPressed?: boolean;
  prPublishProgress?: number;
  stageActionPressed?: boolean;
};
