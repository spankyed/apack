import { given, type Read } from '@apackdev/state';
import { state } from '#generated/state.ts';
import type { CommitStatus, GitFailure } from '#features/code/be/contract.ts';
import type {
  BlameLine,
  ChangedFile,
  CommitFailure,
  CommitTrailer,
  ConflictKind,
  DiffHunk,
  GitProgress,
  HistoryCommit,
  LineCount,
  MergePreview,
  OperationMove,
  ProgressDuring,
  RepositoryChange,
  RepositoryOperation,
  RepositoryUnder,
  RewriteAction,
  SignInHelp,
  SlowStatus,
  StartableOperation,
  StashEntry,
  WorktreeEntry,
} from '#features/code/be/types.ts';
import { withStaged, withUnstaged } from '@apackdev/git/staging';
import { diffTabPath } from '../../utils/diff-tabs.ts';

/**
 * What the trailers a message ends with are read from: its last paragraph, when it has more than one. A message of
 * one paragraph has none, that being its subject (`trailersIn`), so typing one asks git nothing.
 */
export function trailerParagraph(message: string): string | undefined {
  const paragraphs = message.split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.trim());
  return paragraphs.length > 1 ? paragraphs.at(-1) : undefined;
}

// Git types
export interface GitStatusFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied' | 'typechange' | 'unmerged';
  staged: boolean;
  originalPath?: string;
  score?: number;
  conflict?: ConflictKind;
  isDirectory?: boolean;
  submodule?: { commit: boolean; modified: boolean; untracked: boolean };
  nameNotText?: true;
}

/** What an open folder row lists: the files in it that git would list, each by its path from the top of the checkout */
export interface OpenFolder {
  files: string[];
  truncated: boolean;
}

export interface GitDiff {
  path: string;
  staged: boolean;
  originalContent?: string;
  modifiedContent?: string;
  isImage?: boolean;
  hunks?: DiffHunk[];
  conflict?: { base: string | null; ours: string | null; theirs: string | null };
}

export type { StashEntry, WorktreeEntry };

/** A commit as the panel's history draws it: with every parent, and the refs that point at it */
export type CommitLogEntry = HistoryCommit;

export type GitFailureDetails = Pick<
  CommitFailure,
  'code' | 'during' | 'signIn' | 'trust' | 'ownership' | 'hook' | 'missingBranch'
>;

export type Refusal = { message: string } & Partial<GitFailure>;

export type OpenDiffRef = { tab: string; path: string; staged: boolean };

export type RewriteRequest =
  | { type: 'commit.AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean };

export type CommitReport =
  | { type: 'OPEN_DIFF_TAB'; diff: GitDiff }
  | { type: 'ACTIVATE_DIFF_TAB'; tab: string }
  | { type: 'REFRESH_DIFF_TAB'; diff: GitDiff }
  | { type: 'OPEN_FILE_TAB'; file: GitStatusFile };

export type CommitChildReport =
  | { type: 'CHILD_ERROR'; failure: Refusal }
  | { type: 'CHILD_CLEAR_ERROR' }
  | { type: 'CHILD_UNDOABLE'; undoable: { id: string; summary: string } | null }
  | { type: 'CLEAR_COMMIT_MESSAGE'; clearSelection?: boolean }
  | { type: 'SET_COMMIT_MESSAGE'; message: string; expectedMessage?: string }
  | { type: 'GENERATE_MESSAGE_FAILED' }
  | { type: 'REQUEST_STATUS_REFRESH' }
  | { type: 'REQUEST_LOG_REFRESH' }
  | { type: 'CHILD_PROGRESS'; progress: { during: ProgressDuring } & GitProgress }
  | { type: 'CHILD_CLEAR_PROGRESS'; during: ProgressDuring }
  | { type: 'CHILD_PUBLISHED_REWRITE'; message: string; request: RewriteRequest }
  | { type: 'CONFIRMED_HISTORY_REWRITE'; request: Extract<RewriteRequest, { type: 'commit.REWRITE_COMMIT' }> };

const failureShown = ({
  message,
  code,
  during,
  signIn,
  trust,
  ownership,
  hook,
  missingBranch,
}: Read<Refusal>): { gitError: string; gitFailure: GitFailureDetails; statusFailed: false } => ({
  gitError: message,
  gitFailure: { code, during, signIn, trust, ownership, hook, missingBranch },
  statusFailed: false,
});

const STATUS_READ_FAILURES: readonly CommitFailure['code'][] = [
  'not-a-repository',
  'untrusted',
  'unsafe-ownership',
  'git-not-found',
  'developer-tools-missing',
  'git-too-old',
];

const statusReadClears = (statusFailed: boolean, gitFailure: Read<GitFailureDetails> | null): boolean =>
  statusFailed || STATUS_READ_FAILURES.includes(gitFailure?.code);

const bothChanges = (one: Read<RepositoryChange> | null, other: Read<RepositoryChange>): RepositoryChange => {
  if (!one) {
    return {
      status: other.status,
      diffs: other.diffs,
      history: other.history,
      stashes: other.stashes,
      refs: other.refs,
      worktrees: other.worktrees,
      ...(other.files ? { files: [...other.files] } : {}),
    };
  }
  const named = (change: Read<RepositoryChange>) => !change.diffs || change.files !== undefined;
  const diffs = one.diffs || other.diffs;
  return {
    status: one.status || other.status,
    diffs,
    history: one.history || other.history,
    stashes: one.stashes || other.stashes,
    refs: one.refs || other.refs,
    worktrees: one.worktrees || other.worktrees,
    ...(diffs && named(one) && named(other)
      ? { files: [...new Set([...(one.files ?? []), ...(other.files ?? [])])] }
      : {}),
  };
};

const sameStashes = (one: readonly Read<StashEntry>[], other: readonly Read<StashEntry>[]) =>
  one.length === other.length &&
  one.every(
    (stash, i) =>
      stash.ref === other[i]!.ref && stash.date === other[i]!.date && stash.message === other[i]!.message,
  );

// ── 1. `composer` child (1 load, 4 calls) ─────────────────────────────────────────────────────────

type ComposerShape = {
  data: {
    trailersMessage: string;
    trailersParagraph: string | null;
    trailersRequestMessage: string;
    trailers: CommitTrailer[];
    rewriteConfirmation: { message: string; request: RewriteRequest } | null;
    pendingRewrite: RewriteRequest | null;
  };
  reports: CommitChildReport;
  calls: {
    commit: { readonly one: { message: string } };
    amend: { readonly one: { message?: string; evenIfPublished?: boolean } };
    removeTrailer: { readonly many: { message: string; trailer: CommitTrailer } };
    generateMessage: 'many';
  };
};

export type ComposerEvent =
  | { type: 'MESSAGE_CHANGED'; message: string }
  | { type: 'COMMIT'; message: string }
  | { type: 'AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'SET_REWRITE_CONFIRMATION'; message: string; request: RewriteRequest }
  | { type: 'CONFIRM_REWRITE' }
  | { type: 'DISMISS_REWRITE' }
  | { type: 'REMOVE_TRAILER'; message: string; trailer: CommitTrailer }
  | { type: 'GENERATE_MESSAGE' };

export const composerState = state<ComposerShape, ComposerEvent>()({
  data: {
    trailersMessage: '',
    trailersParagraph: null,
    trailersRequestMessage: '',
    trailers: [],
    rewriteConfirmation: null,
    pendingRewrite: null,
  },
  loads: (load) => ({
    trailers: load('code', 'commit.READ_TRAILERS', {
      from: ['trailersParagraph', 'trailersRequestMessage'],
      args: ({ trailersParagraph, trailersRequestMessage }) =>
        trailersParagraph ? { message: trailersRequestMessage } : null,
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        if (trailerParagraph(outcome.value.message) !== trailerParagraph(data.trailersMessage)) return;
        return { data: { trailers: outcome.value.trailers } };
      },
    }),
  }),
  calls: ({ one, many }) => ({
    commit: one('code', 'commit.COMMIT', {
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'CLEAR_COMMIT_MESSAGE', clearSelection: true });
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return { data: { trailersMessage: '', trailersParagraph: null, trailersRequestMessage: '', trailers: [] } };
      },
    }),
    amend: one('code', 'commit.AMEND', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          if (outcome.failure.kind === 'published') {
            return {
              data: {
                rewriteConfirmation: data.pendingRewrite
                  ? { message: outcome.failure.message, request: data.pendingRewrite as RewriteRequest }
                  : null,
              },
            };
          }
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'CLEAR_COMMIT_MESSAGE' });
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        report({ type: 'REQUEST_LOG_REFRESH' });
        return {
          data: {
            rewriteConfirmation: null,
            pendingRewrite: null,
            trailersMessage: '',
            trailersParagraph: null,
            trailersRequestMessage: '',
            trailers: [],
          },
        };
      },
    }),
    removeTrailer: many('code', 'commit.REMOVE_TRAILER', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        if (outcome.value.message !== data.trailersMessage) return;
        const without = outcome.value.without;
        const paragraph = trailerParagraph(without) ?? null;
        report({ type: 'SET_COMMIT_MESSAGE', message: without, expectedMessage: outcome.value.message });
        return {
          data: {
            trailersMessage: without,
            trailersParagraph: paragraph,
            ...(paragraph !== data.trailersParagraph ? { trailersRequestMessage: without } : {}),
            ...(paragraph ? {} : { trailers: [] }),
          },
        };
      },
    }),
    generateMessage: many('code', 'commit.GENERATE_MESSAGE', {
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          report({ type: 'GENERATE_MESSAGE_FAILED' });
        }
      },
    }),
  }),
  on: {
    MESSAGE_CHANGED: ({ message }, { data }) => {
      const paragraph = trailerParagraph(message) ?? null;
      if (paragraph === data.trailersParagraph && message === data.trailersMessage) return;
      return {
        data: {
          trailersMessage: message,
          trailersParagraph: paragraph,
          ...(paragraph !== data.trailersParagraph ? { trailersRequestMessage: message } : {}),
          ...(paragraph ? {} : { trailers: [] }),
        },
      };
    },
    COMMIT: ({ message }, { snapshot, call }) => {
      const trimmed = message.trim();
      if (!trimmed || snapshot.pending.commit || snapshot.pending.amend) return;
      call('commit', { message: trimmed });
    },
    AMEND: ({ message, evenIfPublished }, { snapshot, call, report }) => {
      if (snapshot.pending.commit || snapshot.pending.amend) return;
      const req: RewriteRequest = { type: 'commit.AMEND', message, evenIfPublished };
      report({ type: 'CHILD_CLEAR_ERROR' });
      call('amend', { message, evenIfPublished });
      return { data: { pendingRewrite: req, rewriteConfirmation: null } };
    },
    SET_REWRITE_CONFIRMATION: ({ message, request }) => ({
      data: { rewriteConfirmation: { message, request }, pendingRewrite: request },
    }),
    CONFIRM_REWRITE: (_event, { data, snapshot, call, report }) => {
      const req = data.rewriteConfirmation?.request;
      if (!req) return { data: { rewriteConfirmation: null } };
      if (req.type === 'commit.AMEND') {
        if (snapshot.pending.commit || snapshot.pending.amend) return;
        call('amend', { message: req.message, evenIfPublished: true });
        return { data: { rewriteConfirmation: null, pendingRewrite: { ...req, evenIfPublished: true } } };
      }
      report({ type: 'CONFIRMED_HISTORY_REWRITE', request: req as Extract<RewriteRequest, { type: 'commit.REWRITE_COMMIT' }> });
      return { data: { rewriteConfirmation: null } };
    },
    DISMISS_REWRITE: () => ({ data: { rewriteConfirmation: null, pendingRewrite: null } }),
    REMOVE_TRAILER: ({ message, trailer }, { call }) => {
      call('removeTrailer', { message, trailer });
    },
    GENERATE_MESSAGE: (_event, { call }) => {
      call('generateMessage');
    },
  },
});

// ── 2. `recovery` child (1 load, 4 calls) ─────────────────────────────────────────────────────────

type RecoveryShape = {
  data: {
    revertDialogFile: GitStatusFile | null;
    discardPreviewPaths: string[] | null;
    discardPreview: { paths: string[]; notKept: string[] } | null;
    lastDiscard: { id: string; paths: string[]; notKept: string[] } | null;
    discardLeft: string[];
    lastUndoable: { id: string; summary: string } | null;
    undoConfirmation: string | null;
  };
  reports: CommitChildReport;
  calls: {
    revertFile: { readonly many: string };
    revertFiles: { readonly many: string[] };
    restoreDiscarded: { readonly many: string };
    undoLast: { readonly many: { evenIfPublished?: boolean } };
  };
};

export type RecoveryEvent =
  | { type: 'TOGGLE_REVERT_DIALOG'; file?: GitStatusFile }
  | { type: 'PREVIEW_DISCARD'; paths: string[] }
  | { type: 'REVERT_FILE'; path?: string }
  | { type: 'REVERT_FILES'; paths: string[] }
  | { type: 'UNDO_DISCARD' }
  | { type: 'DISMISS_DISCARD' }
  | { type: 'UNDO_LAST'; evenIfPublished?: boolean }
  | { type: 'DISMISS_UNDO' }
  | { type: 'SET_UNDOABLE'; undoable: { id: string; summary: string } | null };

export const recoveryState = state<RecoveryShape, RecoveryEvent>()({
  data: {
    revertDialogFile: null,
    discardPreviewPaths: null,
    discardPreview: null,
    lastDiscard: null,
    discardLeft: [],
    lastUndoable: null,
    undoConfirmation: null,
  },
  loads: (load) => ({
    discardPreview: load('code', 'commit.PREVIEW_DISCARD', {
      from: ['discardPreviewPaths'],
      args: ({ discardPreviewPaths }) =>
        discardPreviewPaths && discardPreviewPaths.length > 0 ? { paths: discardPreviewPaths } : null,
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { discardPreview: outcome.value } };
      },
    }),
  }),
  calls: ({ many }) => ({
    revertFile: many('code', 'commit.REVERT_FILE', {
      args: (path) => ({ path }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        const { path, kept } = outcome.value;
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return {
          data: {
            revertDialogFile: null,
            lastDiscard: kept.id ? { id: kept.id, paths: [path], notKept: kept.notKept } : data.lastDiscard,
            discardLeft: [],
            discardPreview: null,
          },
        };
      },
    }),
    revertFiles: many('code', 'commit.REVERT_FILES', {
      args: (paths) => ({ paths }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        const { paths, kept } = outcome.value;
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return {
          data: {
            lastDiscard: kept.id ? { id: kept.id, paths, notKept: kept.notKept } : data.lastDiscard,
            discardLeft: [],
            discardPreview: null,
          },
        };
      },
    }),
    restoreDiscarded: many('code', 'commit.RESTORE_DISCARDED', {
      args: (id) => ({ id }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'REQUEST_STATUS_REFRESH' });
        if (data.lastDiscard?.id !== outcome.value.id) return;
        return { data: { lastDiscard: null, discardLeft: outcome.value.left } };
      },
    }),
    undoLast: many('code', 'commit.UNDO_LAST', {
      args: (input) => (input.evenIfPublished ? { evenIfPublished: true } : {}),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          if (outcome.failure.kind === 'published') {
            return { data: { undoConfirmation: outcome.failure.message } };
          }
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return {
          data: {
            undoConfirmation: null,
            lastUndoable: 'undoable' in outcome.value ? (outcome.value.undoable ?? null) : data.lastUndoable,
          },
        };
      },
    }),
  }),
  on: {
    TOGGLE_REVERT_DIALOG: ({ file }) => ({
      data: {
        revertDialogFile: file ?? null,
        ...(file ? { discardPreviewPaths: [file.path] } : {}),
      },
    }),
    PREVIEW_DISCARD: ({ paths }) => ({ data: { discardPreviewPaths: [...paths] } }),
    REVERT_FILE: ({ path }, { data, call }) => {
      const target = data.revertDialogFile?.path ?? path;
      if (target) call('revertFile', target);
      return { data: { revertDialogFile: null } };
    },
    REVERT_FILES: ({ paths }, { call }) => {
      call('revertFiles', paths);
    },
    UNDO_DISCARD: (_event, { data, call }) => {
      if (data.lastDiscard) call('restoreDiscarded', data.lastDiscard.id);
    },
    DISMISS_DISCARD: () => ({ data: { lastDiscard: null, discardLeft: [] } }),
    UNDO_LAST: ({ evenIfPublished }, { call }) => {
      call('undoLast', { evenIfPublished });
      return { data: { undoConfirmation: null } };
    },
    DISMISS_UNDO: () => ({ data: { lastUndoable: null, undoConfirmation: null } }),
    SET_UNDOABLE: ({ undoable }) => ({ data: { lastUndoable: undoable } }),
  },
});

// ── 3. `history` child (2 loads, 3 calls) ─────────────────────────────────────────────────────────

type HistoryShape = {
  data: {
    logRev: number;
    logPath: string | null;
    logLoadCursor: string | null;
    commitLog: CommitLogEntry[];
    logCursor: string | null;
    rewordHash: string | null;
    rewording: { hash: string; message: string | null } | null;
    resettingTo: string | null;
  };
  reports: CommitChildReport;
  calls: {
    rewrite: { readonly many: { hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean } };
    revertCommit: { readonly many: string };
    reset: { readonly one: string };
  };
};

export type HistoryEvent =
  | { type: 'LOG_LIST' }
  | { type: 'LOAD_MORE_LOG' }
  | { type: 'SHOW_FILE_HISTORY'; path: string }
  | { type: 'CLEAR_FILE_HISTORY' }
  | { type: 'START_REWORD'; hash: string }
  | { type: 'CANCEL_REWORD' }
  | { type: 'REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean }
  | { type: 'REVERT_COMMIT'; hash: string }
  | { type: 'RESET_TO_COMMIT'; hash: string };

export const historyState = state<HistoryShape, HistoryEvent>()({
  data: {
    logRev: 1,
    logPath: null,
    logLoadCursor: null,
    commitLog: [],
    logCursor: null,
    rewordHash: null,
    rewording: null,
    resettingTo: null,
  },
  loads: (load) => ({
    log: load('code', 'commit.LOG_LIST', {
      from: ['logRev', 'logPath', 'logLoadCursor'],
      args: ({ logPath, logLoadCursor }) => ({
        ...(logPath ? { path: logPath } : {}),
        ...(logLoadCursor ? { cursor: logLoadCursor } : {}),
      }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return {
          data: {
            commitLog: outcome.value.continued ? [...data.commitLog, ...outcome.value.commits] : outcome.value.commits,
            logCursor: outcome.value.cursor ?? null,
          },
        };
      },
    }),
    reword: load('code', 'commit.GET_COMMIT_MESSAGE', {
      from: ['rewordHash'],
      args: ({ rewordHash }) => (rewordHash ? { hash: rewordHash } : null),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return { data: { rewording: null, rewordHash: null } };
        }
        return { data: { rewording: { hash: outcome.value.hash, message: outcome.value.message } } };
      },
    }),
  }),
  calls: ({ one, many }) => ({
    rewrite: many('code', 'commit.REWRITE_COMMIT', {
      done: (outcome, { input, data, report }) => {
        if (!outcome.ok) {
          if (outcome.failure.kind === 'published') {
            report({
              type: 'CHILD_PUBLISHED_REWRITE',
              message: outcome.failure.message,
              request: {
                type: 'commit.REWRITE_COMMIT',
                hash: input.hash,
                action: input.action,
                message: input.message,
                evenIfPublished: input.evenIfPublished,
              },
            });
            return;
          }
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        return { data: { rewording: null, rewordHash: null, logRev: data.logRev + 1, logLoadCursor: null } };
      },
    }),
    revertCommit: many('code', 'commit.REVERT_COMMIT', {
      args: (hash) => ({ hash }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return { data: { logRev: data.logRev + 1, logLoadCursor: null } };
      },
    }),
    reset: one('code', 'commit.RESET_TO_COMMIT', {
      args: (hash) => ({ hash }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
        } else if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        return { data: { resettingTo: null } };
      },
    }),
  }),
  on: {
    LOG_LIST: (_event, { data }) => ({ data: { logRev: data.logRev + 1, logLoadCursor: null } }),
    LOAD_MORE_LOG: (_event, { data }) => (data.logCursor ? { data: { logLoadCursor: data.logCursor } } : undefined),
    SHOW_FILE_HISTORY: ({ path }, { data }) => ({
      data: { logPath: path, commitLog: [], logCursor: null, logLoadCursor: null, logRev: data.logRev + 1 },
    }),
    CLEAR_FILE_HISTORY: (_event, { data }) => ({
      data: { logPath: null, commitLog: [], logCursor: null, logLoadCursor: null, logRev: data.logRev + 1 },
    }),
    START_REWORD: ({ hash }) => ({ data: { rewordHash: hash, rewording: { hash, message: null } } }),
    CANCEL_REWORD: () => ({ data: { rewordHash: null, rewording: null } }),
    REWRITE_COMMIT: (ev, { call, report }) => {
      report({ type: 'CHILD_CLEAR_ERROR' });
      call('rewrite', { hash: ev.hash, action: ev.action, message: ev.message, evenIfPublished: ev.evenIfPublished });
    },
    REVERT_COMMIT: ({ hash }, { call }) => {
      call('revertCommit', hash);
    },
    RESET_TO_COMMIT: ({ hash }, { cancel, call }) => {
      cancel('reset');
      call('reset', hash);
      return { data: { resettingTo: hash } };
    },
  },
});

// ── 4. `remotes` child (2 loads, 11 calls) ────────────────────────────────────────────────────────

type RemotesShape = {
  data: {
    branchesRev: number;
    availableBranches: string[];
    tags: { name: string; commit: string }[];
    branchStanding: Record<string, { upstream?: string; upstreamGone?: boolean; ahead: number; behind: number }>;
    branchInput: string;
    mergePreviewTarget: string | null;
    mergePreview: { target: string; preview: MergePreview } | null;
    pushStopped: boolean;
    tagBusy: { name: string; action: 'push' | 'delete' } | null;
    tagPushed: { name: string } | null;
  };
  reports: CommitChildReport;
  calls: {
    push: 'one';
    pull: 'one';
    checkout: { readonly one: { branchName: string; pull?: boolean } };
    createBranch: { readonly one: string };
    signIn: { readonly one: { host: string; during?: 'push' | 'pull' } };
    moveOperation: { readonly one: OperationMove };
    startOperation: { readonly one: { kind: StartableOperation; target: string } };
    tagPush: { readonly one: string };
    tagDelete: { readonly one: string };
    renameBranch: { readonly many: { name: string; to: string } };
    createTag: { readonly many: { name: string; commit?: string; message?: string } };
  };
};

export type RemotesEvent =
  | { type: 'GET_ALL_BRANCHES' }
  | { type: 'UPDATE_BRANCH_INPUT'; input: string }
  | { type: 'PREVIEW_MERGE'; target: string }
  | { type: 'PUSH_BRANCH' }
  | { type: 'STOP_PUSH' }
  | { type: 'PULL_BRANCH' }
  | { type: 'CHECKOUT_BRANCH'; branchName?: string; pull?: boolean }
  | { type: 'CREATE_BRANCH'; branchName: string }
  | { type: 'SET_UP_SIGN_IN'; host: string; during?: 'push' | 'pull' }
  | { type: 'MOVE_OPERATION'; move: OperationMove }
  | { type: 'START_OPERATION'; kind: StartableOperation; target: string }
  | { type: 'PUSH_TAG'; name: string }
  | { type: 'DELETE_TAG'; name: string }
  | { type: 'RENAME_BRANCH'; name: string; to: string }
  | { type: 'CREATE_TAG'; name: string; commit?: string; message?: string };

export const remotesState = state<RemotesShape, RemotesEvent>()({
  data: {
    branchesRev: 1,
    availableBranches: [],
    tags: [],
    branchStanding: {},
    branchInput: '',
    mergePreviewTarget: null,
    mergePreview: null,
    pushStopped: false,
    tagBusy: null,
    tagPushed: null,
  },
  loads: (load) => ({
    branches: load('code', 'commit.GET_ALL_BRANCHES', {
      from: ['branchesRev'],
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return {
          data: {
            availableBranches: outcome.value.branches,
            branchStanding: outcome.value.standing ?? {},
            tags: outcome.value.tags ?? [],
          },
        };
      },
    }),
    mergePreview: load('code', 'commit.PREVIEW_MERGE', {
      from: ['mergePreviewTarget'],
      args: ({ mergePreviewTarget }) => (mergePreviewTarget ? { target: mergePreviewTarget } : null),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { mergePreview: outcome.value } };
      },
    }),
  }),
  calls: ({ one, many }) => ({
    push: one('code', 'commit.PUBLISH_BRANCH', {
      progress: (updates, { report }) => {
        const latest = updates.at(-1);
        if (latest) report({ type: 'CHILD_PROGRESS', progress: latest });
      },
      done: (outcome, { report }) => {
        report({ type: 'CHILD_CLEAR_PROGRESS', during: 'push' });
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
        }
      },
    }),
    pull: one('code', 'commit.PULL_BRANCH', {
      progress: (updates, { report }) => {
        const latest = updates.at(-1);
        if (latest) report({ type: 'CHILD_PROGRESS', progress: latest });
      },
      done: (outcome, { report }) => {
        report({ type: 'CHILD_CLEAR_PROGRESS', during: 'pull' });
        if (!outcome.ok) report({ type: 'CHILD_ERROR', failure: outcome.failure });
      },
    }),
    checkout: one('code', 'commit.CHECKOUT_BRANCH', {
      progress: (updates, { report }) => {
        const latest = updates.at(-1);
        if (latest) report({ type: 'CHILD_PROGRESS', progress: latest });
      },
      done: (outcome, { data, report }) => {
        report({ type: 'CHILD_CLEAR_PROGRESS', during: 'checkout' });
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { branchInput: '', branchesRev: data.branchesRev + 1 } };
      },
    }),
    createBranch: one('code', 'commit.CREATE_BRANCH', {
      args: (branchName) => ({ branchName }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { branchInput: '', branchesRev: data.branchesRev + 1 } };
      },
    }),
    signIn: one('code', 'commit.SET_UP_SIGN_IN', {
      args: (input) => ({ host: input.host, ...(input.during ? { during: input.during } : {}) }),
      done: (outcome, { snapshot, call, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'CHILD_CLEAR_ERROR' });
        if (outcome.value.during === 'push' && !snapshot.pending.push) {
          call('push');
          return { data: { pushStopped: false } };
        }
        if (outcome.value.during === 'pull' && !snapshot.pending.pull) {
          call('pull');
        }
      },
    }),
    moveOperation: one('code', 'commit.MOVE_OPERATION', {
      args: (move) => ({ move }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', failure: outcome.failure });
      },
    }),
    startOperation: one('code', 'commit.START_OPERATION', {
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        report({ type: 'REQUEST_LOG_REFRESH' });
      },
    }),
    tagPush: one('code', 'commit.PUSH_TAG', {
      args: (name) => ({ name }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return { data: { tagBusy: null } };
        }
        return { data: { tagBusy: null, tagPushed: { name: outcome.value.name } } };
      },
    }),
    tagDelete: one('code', 'commit.DELETE_TAG', {
      args: (name) => ({ name }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return { data: { tagBusy: null } };
        }
        report({ type: 'REQUEST_LOG_REFRESH' });
        return { data: { tagBusy: null, branchesRev: data.branchesRev + 1 } };
      },
    }),
    renameBranch: many('code', 'commit.RENAME_BRANCH', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'REQUEST_LOG_REFRESH' });
        return { data: { branchesRev: data.branchesRev + 1 } };
      },
    }),
    createTag: many('code', 'commit.CREATE_TAG', {
      args: (input) => ({
        name: input.name,
        ...(input.commit ? { commit: input.commit } : {}),
        ...(input.message ? { message: input.message } : {}),
      }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'REQUEST_LOG_REFRESH' });
        return { data: { branchesRev: data.branchesRev + 1 } };
      },
    }),
  }),
  on: {
    GET_ALL_BRANCHES: (_event, { data }) => ({ data: { branchesRev: data.branchesRev + 1 } }),
    UPDATE_BRANCH_INPUT: ({ input }) => ({ data: { branchInput: input } }),
    PREVIEW_MERGE: ({ target }) => ({ data: { mergePreviewTarget: target } }),
    PUSH_BRANCH: (_event, { snapshot, call }) => {
      if (snapshot.pending.push) return;
      call('push');
      return { data: { pushStopped: false } };
    },
    STOP_PUSH: (_event, { snapshot, cancel, report }) => {
      if (!snapshot.pending.push) return;
      cancel('push');
      report({ type: 'CHILD_CLEAR_PROGRESS', during: 'push' });
      return { data: { pushStopped: true } };
    },
    PULL_BRANCH: (_event, { snapshot, call }) => {
      if (snapshot.pending.pull) return;
      call('pull');
    },
    CHECKOUT_BRANCH: ({ branchName, pull }, { data, cancel, call, report }) => {
      const target = (branchName ?? data.branchInput).trim();
      if (!target) return;
      cancel('createBranch');
      cancel('checkout');
      report({ type: 'CHILD_CLEAR_PROGRESS', during: 'checkout' });
      call('checkout', { branchName: target, ...(pull !== undefined ? { pull } : {}) });
    },
    CREATE_BRANCH: ({ branchName }, { cancel, call, report }) => {
      const target = branchName.trim();
      if (!target) return;
      cancel('checkout');
      cancel('createBranch');
      report({ type: 'CHILD_CLEAR_ERROR' });
      report({ type: 'CHILD_CLEAR_PROGRESS', during: 'checkout' });
      call('createBranch', target);
    },
    SET_UP_SIGN_IN: ({ host, during }, { cancel, call }) => {
      cancel('signIn');
      call('signIn', { host, during });
    },
    MOVE_OPERATION: ({ move }, { cancel, call, report }) => {
      report({ type: 'CHILD_CLEAR_ERROR' });
      cancel('moveOperation');
      call('moveOperation', move);
    },
    START_OPERATION: ({ kind, target }, { cancel, call, report }) => {
      report({ type: 'CHILD_CLEAR_ERROR' });
      cancel('startOperation');
      call('startOperation', { kind, target });
    },
    PUSH_TAG: ({ name }, { cancel, call }) => {
      cancel('tagDelete');
      cancel('tagPush');
      call('tagPush', name);
      return { data: { tagBusy: { name, action: 'push' } } };
    },
    DELETE_TAG: ({ name }, { cancel, call }) => {
      cancel('tagPush');
      cancel('tagDelete');
      call('tagDelete', name);
      return { data: { tagBusy: { name, action: 'delete' } } };
    },
    RENAME_BRANCH: ({ name, to }, { call }) => {
      call('renameBranch', { name, to });
    },
    CREATE_TAG: ({ name, commit, message }, { call }) => {
      call('createTag', { name, commit, message });
    },
  },
});

// ── 5. `stashes` child (1 load, 6 calls) ──────────────────────────────────────────────────────────

type StashesShape = {
  data: {
    stashesRev: number;
    stashList: StashEntry[];
    stashFiles: Record<string, ChangedFile[]>;
    stashTakesMessage: boolean;
  };
  reports: CommitChildReport;
  calls: {
    stashFiles: 'each';
    stash: { readonly one: { message?: string; stagedOnly?: boolean; paths?: string[] } };
    stashApply: { readonly many: number };
    stashPop: { readonly many: number };
    stashDrop: { readonly many: number };
    stashClear: 'many';
  };
};

export type StashesEvent =
  | { type: 'STASH_LIST' }
  | { type: 'TOGGLE_STASH_FILES'; index: number }
  | { type: 'STASH_PUSH'; message?: string; stagedOnly?: boolean; paths?: string[]; takesMessage?: boolean }
  | { type: 'STASH_APPLY'; index: number }
  | { type: 'STASH_POP'; index: number }
  | { type: 'STASH_DROP'; index: number }
  | { type: 'STASH_CLEAR' };

export const stashesState = state<StashesShape, StashesEvent>()({
  data: {
    stashesRev: 1,
    stashList: [],
    stashFiles: {},
    stashTakesMessage: false,
  },
  loads: (load) => ({
    stashes: load('code', 'commit.STASH_LIST', {
      from: ['stashesRev'],
      done: (outcome, { data, snapshot, cancel, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        const { stashes } = outcome.value;
        if (sameStashes(data.stashList, stashes)) return { data: { stashList: stashes } };
        for (const key of Object.keys(snapshot.pending.stashFiles)) cancel('stashFiles', key);
        return { data: { stashList: stashes, stashFiles: {} } };
      },
    }),
  }),
  calls: ({ one, each, many }) => ({
    stashFiles: each('code', 'commit.GET_STASH_CHANGES', {
      args: (key) => ({ index: Number(key) }),
      done: (outcome, { key, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return {
          data: (d) => {
            d.stashFiles[key] = outcome.value.files;
          },
        };
      },
    }),
    stash: one('code', 'commit.STASH_PUSH', {
      args: (input) => ({
        message: input.message,
        stagedOnly: input.stagedOnly,
        ...(input.paths ? { paths: input.paths } : {}),
      }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return { data: { stashTakesMessage: false } };
        }
        if (data.stashTakesMessage) report({ type: 'CLEAR_COMMIT_MESSAGE' });
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return { data: { stashTakesMessage: false } };
      },
    }),
    stashApply: many('code', 'commit.STASH_APPLY', {
      args: (index) => ({ index }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return { data: { stashesRev: data.stashesRev + 1 } };
      },
    }),
    stashPop: many('code', 'commit.STASH_POP', {
      args: (index) => ({ index }),
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        report({ type: 'REQUEST_STATUS_REFRESH' });
        return { data: { stashesRev: data.stashesRev + 1 } };
      },
    }),
    stashDrop: many('code', 'commit.STASH_DROP', {
      args: (index) => ({ index }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', failure: outcome.failure });
        else if (outcome.value.undoable !== undefined) report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
      },
    }),
    stashClear: many('code', 'commit.STASH_CLEAR', {
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', failure: outcome.failure });
        else if (outcome.value.undoable !== undefined) report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
      },
    }),
  }),
  on: {
    STASH_LIST: (_event, { data }) => ({ data: { stashesRev: data.stashesRev + 1 } }),
    TOGGLE_STASH_FILES: ({ index }, { data, cancel, call }) => {
      const key = String(index);
      if (key in data.stashFiles) {
        cancel('stashFiles', key);
        return {
          data: (d) => {
            delete d.stashFiles[key];
          },
        };
      }
      cancel('stashFiles', key);
      call('stashFiles', key);
    },
    STASH_PUSH: ({ message, stagedOnly, paths, takesMessage }, { cancel, call }) => {
      cancel('stash');
      call('stash', { message, stagedOnly, paths });
      return { data: { stashTakesMessage: takesMessage === true } };
    },
    STASH_APPLY: ({ index }, { call }) => {
      call('stashApply', index);
    },
    STASH_POP: ({ index }, { call }) => {
      call('stashPop', index);
    },
    STASH_DROP: ({ index }, { call }) => {
      call('stashDrop', index);
    },
    STASH_CLEAR: (_event, { call }) => {
      call('stashClear');
    },
  },
});

// ── 6. `worktrees` child (1 load, 3 calls) ────────────────────────────────────────────────────────

type WorktreesShape = {
  data: {
    worktreesRev: number;
    worktreeList: WorktreeEntry[];
  };
  reports: CommitChildReport;
  calls: {
    worktreeAdd: { readonly one: { path: string; branch?: string; createBranch?: boolean } };
    worktreeRemove: { readonly one: { path: string; force?: boolean } };
    worktreeSwitch: { readonly one: string };
  };
};

export type WorktreesEvent =
  | { type: 'WORKTREE_LIST' }
  | { type: 'WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
  | { type: 'WORKTREE_REMOVE'; path: string; force?: boolean }
  | { type: 'WORKTREE_SWITCH'; path: string };

export const worktreesState = state<WorktreesShape, WorktreesEvent>()({
  data: {
    worktreesRev: 1,
    worktreeList: [],
  },
  loads: (load) => ({
    worktrees: load('code', 'commit.WORKTREE_LIST', {
      from: ['worktreesRev'],
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { worktreeList: outcome.value.worktrees } };
      },
    }),
  }),
  calls: ({ one }) => ({
    worktreeAdd: one('code', 'commit.WORKTREE_ADD', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { worktreesRev: data.worktreesRev + 1 } };
      },
    }),
    worktreeRemove: one('code', 'commit.WORKTREE_REMOVE', {
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', failure: outcome.failure });
          return;
        }
        return { data: { worktreesRev: data.worktreesRev + 1 } };
      },
    }),
    worktreeSwitch: one('code', 'commit.WORKTREE_SWITCH', {
      args: (path) => ({ path }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', failure: outcome.failure });
      },
    }),
  }),
  on: {
    WORKTREE_LIST: (_event, { data }) => ({ data: { worktreesRev: data.worktreesRev + 1 } }),
    WORKTREE_ADD: (ev, { cancel, call }) => {
      cancel('worktreeAdd');
      cancel('worktreeRemove');
      cancel('worktreeSwitch');
      call('worktreeAdd', { path: ev.path, branch: ev.branch, createBranch: ev.createBranch });
    },
    WORKTREE_REMOVE: (ev, { cancel, call }) => {
      cancel('worktreeAdd');
      cancel('worktreeRemove');
      cancel('worktreeSwitch');
      call('worktreeRemove', { path: ev.path, force: ev.force });
    },
    WORKTREE_SWITCH: ({ path }, { cancel, call }) => {
      cancel('worktreeAdd');
      cancel('worktreeRemove');
      cancel('worktreeSwitch');
      call('worktreeSwitch', path);
    },
  },
});

// ── 7. `commit` root + `commit.open` (3 loads, 13 calls, 6 starts) ────────────────────────────────

export type CommitShape = {
  data: {
    isShown: boolean;
    commitMessage: string;
    appliedHunks: Record<string, string[]>;
    openDiffs: OpenDiffRef[];
    isGeneratingMessage: boolean;
  };
  reports: CommitReport;
  states: {
    closed: {};
    open: {
      data: {
        directory: string;
        statusRev: number;
        statusLoadingShown: boolean;
        reposRev: number;
        blamePath: string | null;
        gitStatus: GitStatusFile[];
        gitBranch: string;
        hasIdentity: boolean;
        pullPreview: MergePreview | null;
        slowStatus: SlowStatus | null;
        gitError: string | null;
        gitFailure: GitFailureDetails | null;
        statusFailed: boolean;
        selectedGitFile: GitStatusFile | null;
        lineCounts: Record<string, LineCount>;
        blame: { path: string; lines: BlameLine[] } | null;
        repositories: RepositoryUnder[];
        hasUpstream: boolean;
        commitsAhead: number;
        commitsBehind: number;
        isStatusTruncated: boolean;
        isWatchingRepository: boolean;
        isWatchSilent: boolean;
        operation: RepositoryOperation | null;
        isFetchSuspended: boolean;
        fetchSignIn: SignInHelp | null;
        missedChange: RepositoryChange | null;
        openFolders: Record<string, OpenFolder>;
        updatingSubmodule: string | null;
        progress: ({ during: ProgressDuring } & GitProgress) | null;
      };
      calls: {
        diff: { readonly each: { path: string; staged: boolean } };
        diffRefresh: { readonly each: { path: string; staged: boolean } };
        stage: { readonly many: string[] };
        unstage: { readonly many: string[] };
        trustRepository: { readonly many: string };
        trustOwnership: 'many';
        resolveConflict: { readonly many: { path: string; strategy: 'ours' | 'theirs' } };
        markResolved: { readonly many: string };
        resolveAllConflicts: { readonly many: 'ours' | 'theirs' };
        untracked: 'each';
        hunk: { readonly one: { path: string; staged: boolean; hunk: string } };
        speedUp: 'one';
        submodule: { readonly one: string };
      };
      starts: {
        composer: typeof composerState;
        recovery: typeof recoveryState;
        history: typeof historyState;
        remotes: typeof remotesState;
        stashes: typeof stashesState;
        worktrees: typeof worktreesState;
      };
    };
  };
};

export type CommitEvent =
  | { type: 'CODE_STARTED'; directory: string }
  | { type: 'OPEN_DIFFS_CHANGED'; openDiffs: OpenDiffRef[] }
  | { type: 'commit.SHOWN' }
  | { type: 'commit.HIDDEN' }
  | { type: 'commit.SELECT_FILE'; file: GitStatusFile }
  | { type: 'commit.CLEAR_DIFF' }
  | { type: 'commit.OPEN_FILE'; file: GitStatusFile }
  | { type: 'commit.SELECT_REPOSITORY'; path: string }
  | { type: 'commit.UPDATE_MESSAGE'; message: string }
  | { type: 'commit.VIEW_DIFF'; path: string; staged: boolean }
  | { type: 'commit.REFRESH_STATUS' }
  | { type: 'commit.READ_STATUS' }
  | { type: 'commit.REPOSITORY_CHANGED'; changed: RepositoryChange }
  | { type: 'commit.STAGE_FILES'; paths: string[] }
  | { type: 'commit.UNSTAGE_FILES'; paths: string[] }
  | { type: 'commit.SHOW_BLAME'; path: string }
  | { type: 'commit.CLEAR_BLAME' }
  | { type: 'commit.TOGGLE_FOLDER'; path: string }
  | { type: 'commit.APPLY_HUNK'; path: string; staged: boolean; hunk: string }
  | { type: 'commit.SPEED_UP_STATUS' }
  | { type: 'commit.UPDATE_SUBMODULE'; path: string }
  | { type: 'commit.TRUST_REPOSITORY'; repository?: string }
  | { type: 'commit.TRUST_OWNERSHIP' }
  | { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MARK_RESOLVED'; path: string }
  | { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
  | { type: 'commit.DISMISS_ERROR' }
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  | { type: 'commit.MESSAGE_NOT_GENERATED'; data: { message: string } }
  // Forwarded convenience events for the 6 children
  | { type: 'commit.COMMIT' }
  | { type: 'commit.AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REMOVE_TRAILER'; trailer: CommitTrailer }
  | { type: 'commit.GENERATE_MESSAGE' }
  | { type: 'commit.CONFIRM_REWRITE' }
  | { type: 'commit.DISMISS_REWRITE' }
  | { type: 'commit.TOGGLE_REVERT_DIALOG'; file?: GitStatusFile }
  | { type: 'commit.PREVIEW_DISCARD'; paths: string[] }
  | { type: 'commit.REVERT_FILE'; path?: string }
  | { type: 'commit.REVERT_FILES'; paths: string[] }
  | { type: 'commit.UNDO_DISCARD' }
  | { type: 'commit.DISMISS_DISCARD' }
  | { type: 'commit.UNDO_LAST'; evenIfPublished?: boolean }
  | { type: 'commit.DISMISS_UNDO' }
  | { type: 'commit.LOG_LIST' }
  | { type: 'commit.LOAD_MORE_LOG' }
  | { type: 'commit.SHOW_FILE_HISTORY'; path: string }
  | { type: 'commit.CLEAR_FILE_HISTORY' }
  | { type: 'commit.START_REWORD'; hash: string }
  | { type: 'commit.CANCEL_REWORD' }
  | { type: 'commit.REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REVERT_COMMIT'; hash: string }
  | { type: 'commit.RESET_TO_COMMIT'; hash: string }
  | { type: 'commit.GET_ALL_BRANCHES' }
  | { type: 'commit.UPDATE_BRANCH_INPUT'; input: string }
  | { type: 'commit.PREVIEW_MERGE'; target: string }
  | { type: 'commit.PUSH_BRANCH' }
  | { type: 'commit.STOP_PUSH' }
  | { type: 'commit.PULL_BRANCH' }
  | { type: 'commit.CHECKOUT_BRANCH'; branchName?: string; pull?: boolean }
  | { type: 'commit.CREATE_BRANCH'; branchName: string }
  | { type: 'commit.SET_UP_SIGN_IN'; host: string }
  | { type: 'commit.MOVE_OPERATION'; move: OperationMove }
  | { type: 'commit.START_OPERATION'; kind: StartableOperation; target: string }
  | { type: 'commit.PUSH_TAG'; name: string }
  | { type: 'commit.DELETE_TAG'; name: string }
  | { type: 'commit.RENAME_BRANCH'; name: string; to: string }
  | { type: 'commit.CREATE_TAG'; name: string; commit?: string; message?: string }
  | { type: 'commit.STASH_LIST' }
  | { type: 'commit.TOGGLE_STASH_FILES'; index: number }
  | { type: 'commit.STASH_PUSH'; message?: string; stagedOnly?: boolean; paths?: string[] }
  | { type: 'commit.STASH_APPLY'; index: number }
  | { type: 'commit.STASH_POP'; index: number }
  | { type: 'commit.STASH_DROP'; index: number }
  | { type: 'commit.STASH_CLEAR' }
  | { type: 'commit.WORKTREE_LIST' }
  | { type: 'commit.WORKTREE_ADD'; path: string; branch?: string; createBranch?: boolean }
  | { type: 'commit.WORKTREE_REMOVE'; path: string; force?: boolean }
  | { type: 'commit.WORKTREE_SWITCH'; path: string }
  // Reports from the 6 children
  | (CommitChildReport & { from?: string });

const openInitialData = (directory: string) => ({
  directory,
  statusRev: 1,
  statusLoadingShown: true,
  reposRev: 1,
  blamePath: null as string | null,
  gitStatus: [] as GitStatusFile[],
  gitBranch: '',
  hasIdentity: true,
  pullPreview: null as MergePreview | null,
  slowStatus: null as SlowStatus | null,
  gitError: null as string | null,
  gitFailure: null as GitFailureDetails | null,
  statusFailed: false,
  selectedGitFile: null as GitStatusFile | null,
  lineCounts: {} as Record<string, LineCount>,
  blame: null as { path: string; lines: BlameLine[] } | null,
  repositories: [] as RepositoryUnder[],
  hasUpstream: true,
  commitsAhead: 0,
  commitsBehind: 0,
  isStatusTruncated: false,
  isWatchingRepository: true,
  isWatchSilent: false,
  operation: null as RepositoryOperation | null,
  isFetchSuspended: false,
  fetchSignIn: null as SignInHelp | null,
  missedChange: null as RepositoryChange | null,
  openFolders: {} as Record<string, OpenFolder>,
  updatingSubmodule: null as string | null,
  progress: null as ({ during: ProgressDuring } & GitProgress) | null,
});

const applyStatus = (
  status: Read<CommitStatus>,
  stagingUnderWay: boolean,
  currentFiles: readonly Read<GitStatusFile>[],
  currentError: string | null,
  currentFailure: Read<GitFailureDetails> | null,
  statusFailed: boolean,
) => {
  const clears = statusReadClears(statusFailed, currentFailure);
  return {
    lineCounts: Object.fromEntries((status.counts ?? []).map((c) => [`${c.staged}:${c.path}`, c])),
    gitStatus: stagingUnderWay ? [...(currentFiles as GitStatusFile[])] : [...(status.files as GitStatusFile[])],
    hasIdentity: status.hasIdentity ?? true,
    pullPreview: status.pullPreview ?? null,
    slowStatus: status.slowStatus ?? null,
    gitBranch: status.branch,
    hasUpstream: status.hasUpstream,
    commitsAhead: status.commitsAhead,
    commitsBehind: status.commitsBehind,
    isStatusTruncated: status.truncated,
    isWatchingRepository: status.watching,
    operation: status.operation ?? null,
    isFetchSuspended: status.fetchSuspended === true,
    isWatchSilent: status.watchSilent === true,
    fetchSignIn: status.signIn ?? null,
    gitError: clears ? null : currentError,
    gitFailure: clears ? null : currentFailure,
    statusFailed: false,
    statusLoadingShown: false,
  };
};

const withoutAppliedHunks = (appliedHunks: Readonly<Record<string, readonly string[]>>, tab: string) => {
  if (!(tab in appliedHunks)) return undefined;
  const { [tab]: _removed, ...rest } = appliedHunks;
  return rest;
};

export const commitState = state<CommitShape, CommitEvent>()({
  data: {
    isShown: false,
    commitMessage: '',
    appliedHunks: {},
    openDiffs: [],
    isGeneratingMessage: false,
  },
  initial: 'closed',
  on: {
    CODE_STARTED: ({ directory }) =>
      directory
        ? { at: 'open', data: { ...openInitialData(directory), appliedHunks: {}, commitMessage: '', isGeneratingMessage: false } }
        : { at: 'closed', data: { appliedHunks: {}, commitMessage: '', isGeneratingMessage: false } },
    OPEN_DIFFS_CHANGED: ({ openDiffs }) => ({ data: { openDiffs: [...openDiffs] } }),
    'commit.SHOWN': () => ({ data: { isShown: true } }),
    'commit.HIDDEN': () => ({ data: { isShown: false } }),
    'commit.UPDATE_MESSAGE': ({ message }) => ({ data: { commitMessage: message } }),
    'commit.OPEN_FILE': ({ file }, { report }) => {
      report({ type: 'OPEN_FILE_TAB', file });
    },
    'commit.SELECT_REPOSITORY': ({ path }, { tell }) => {
      tell('code', { type: 'SELECT_REPOSITORY', path });
    },
    'commit.GENERATING_MESSAGE': () => ({ data: { isGeneratingMessage: true } }),
    'commit.MESSAGE_GENERATED': ({ data: { message } }) => ({
      data: { isGeneratingMessage: false, commitMessage: message },
    }),
    'commit.MESSAGE_NOT_GENERATED': () => ({ data: { isGeneratingMessage: false } }),
  },
  states: {
    closed: {},
    open: {
      data: {
        directory: given,
        statusRev: 1,
        statusLoadingShown: true,
        reposRev: 1,
        blamePath: null,
        gitStatus: [],
        gitBranch: '',
        hasIdentity: true,
        pullPreview: null,
        slowStatus: null,
        gitError: null,
        gitFailure: null,
        statusFailed: false,
        selectedGitFile: null,
        lineCounts: {},
        blame: null,
        repositories: [],
        hasUpstream: true,
        commitsAhead: 0,
        commitsBehind: 0,
        isStatusTruncated: false,
        isWatchingRepository: true,
        isWatchSilent: false,
        operation: null,
        isFetchSuspended: false,
        fetchSignIn: null,
        missedChange: null,
        openFolders: {},
        updatingSubmodule: null,
        progress: null,
      },
      starts: () => ({
        composer: composerState,
        recovery: recoveryState,
        history: historyState,
        remotes: remotesState,
        stashes: stashesState,
        worktrees: worktreesState,
      }),
      loads: (load) => ({
        status: load('code', 'commit.GET_GIT_STATUS', {
          from: ['statusRev'],
          done: (outcome, { data, snapshot, cancel, call }) => {
            if (!outcome.ok) {
              return {
                data: {
                  ...failureShown(outcome.failure),
                  statusFailed: true,
                  statusLoadingShown: false,
                },
              };
            }
            const stagingUnderWay = snapshot.pending.stage + snapshot.pending.unstage > 0;
            const statusData = applyStatus(
              outcome.value,
              stagingUnderWay,
              data.gitStatus,
              data.gitError,
              data.gitFailure,
              data.statusFailed,
            );

            // Follow open untracked folders: close those gone from status, re-list the rest
            const rows = new Set(statusData.gitStatus.filter((file) => file.isDirectory).map((file) => file.path));
            const openKeys = Object.keys(data.openFolders);
            const hasStale = openKeys.some((path) => !rows.has(path));
            const nextOpenFolders = hasStale
              ? Object.fromEntries(Object.entries(data.openFolders).filter(([path]) => rows.has(path)))
              : undefined;
            for (const path of openKeys) {
              if (rows.has(path)) {
                cancel('untracked', path);
                call('untracked', path);
              }
            }

            return {
              data: {
                ...statusData,
                ...(nextOpenFolders ? { openFolders: nextOpenFolders } : {}),
              },
            };
          },
        }),
        repositories: load('code', 'commit.LIST_REPOSITORIES', {
          from: ['reposRev'],
          done: (outcome) => {
            if (!outcome.ok) return { data: failureShown(outcome.failure) };
            return { data: { repositories: outcome.value.repositories } };
          },
        }),
        blame: load('code', 'commit.GET_BLAME', {
          from: ['blamePath'],
          args: ({ blamePath }) => (blamePath ? { path: blamePath } : null),
          done: (outcome) => {
            if (!outcome.ok) return { data: { blame: null, ...failureShown(outcome.failure) } };
            return { data: { blame: outcome.value } };
          },
        }),
      }),
      calls: ({ one, each, many }) => ({
        stage: many('code', 'commit.STAGE_FILES', {
          args: (paths) => ({ paths }),
          done: (outcome, { data, snapshot }) => {
            const failPatch = outcome.ok ? {} : failureShown(outcome.failure);
            const settlePatch =
              snapshot.pending.stage + snapshot.pending.unstage === 0 ? { statusRev: data.statusRev + 1 } : {};
            if (Object.keys(failPatch).length === 0 && Object.keys(settlePatch).length === 0) return;
            return { data: { ...failPatch, ...settlePatch } };
          },
        }),
        unstage: many('code', 'commit.UNSTAGE_FILES', {
          args: (paths) => ({ paths }),
          done: (outcome, { data, snapshot }) => {
            const failPatch = outcome.ok ? {} : failureShown(outcome.failure);
            const settlePatch =
              snapshot.pending.stage + snapshot.pending.unstage === 0 ? { statusRev: data.statusRev + 1 } : {};
            if (Object.keys(failPatch).length === 0 && Object.keys(settlePatch).length === 0) return;
            return { data: { ...failPatch, ...settlePatch } };
          },
        }),
        trustRepository: many('code', 'commit.TRUST_REPOSITORY', {
          args: (repository) => ({ repository }),
          done: (outcome, { data }) =>
            outcome.ok
              ? { data: { gitError: null, gitFailure: null, statusRev: data.statusRev + 1 } }
              : { data: failureShown(outcome.failure) },
        }),
        trustOwnership: many('code', 'commit.TRUST_OWNERSHIP', {
          done: (outcome, { data }) =>
            outcome.ok
              ? { data: { gitError: null, gitFailure: null, statusRev: data.statusRev + 1 } }
              : { data: failureShown(outcome.failure) },
        }),
        resolveConflict: many('code', 'commit.RESOLVE_CONFLICT', {
          done: (outcome, { data }) =>
            outcome.ok ? { data: { statusRev: data.statusRev + 1 } } : { data: failureShown(outcome.failure) },
        }),
        markResolved: many('code', 'commit.MARK_RESOLVED', {
          args: (path) => ({ path }),
          done: (outcome, { data }) =>
            outcome.ok ? { data: { statusRev: data.statusRev + 1 } } : { data: failureShown(outcome.failure) },
        }),
        resolveAllConflicts: many('code', 'commit.RESOLVE_ALL_CONFLICTS', {
          args: (strategy) => ({ strategy }),
          done: (outcome, { data }) =>
            outcome.ok ? { data: { statusRev: data.statusRev + 1 } } : { data: failureShown(outcome.failure) },
        }),
        untracked: each('code', 'commit.LIST_UNTRACKED', {
          args: (path) => ({ path }),
          done: (outcome, { key, data }) => {
            if (!outcome.ok) return { data: failureShown(outcome.failure) };
            if (!(key in data.openFolders)) return;
            return {
              data: (d) => {
                d.openFolders[key] = { files: outcome.value.files, truncated: outcome.value.truncated };
              },
            };
          },
        }),
        hunk: one('code', 'commit.APPLY_HUNK', {
          done: (outcome) => {
            if (!outcome.ok) return { data: failureShown(outcome.failure) };
            const tab = diffTabPath(outcome.value);
            return {
              data: (d) => {
                const existing = d.appliedHunks[tab] ?? [];
                d.appliedHunks[tab] = [...existing, outcome.value.hunk];
              },
            };
          },
        }),
        speedUp: one('code', 'commit.SPEED_UP_STATUS', {
          done: (outcome) =>
            outcome.ok ? { data: { slowStatus: null } } : { data: failureShown(outcome.failure) },
        }),
        submodule: one('code', 'commit.UPDATE_SUBMODULE', {
          args: (path) => ({ path }),
          progress: (updates) => {
            const latest = updates.at(-1);
            return latest ? { data: { progress: latest } } : undefined;
          },
          done: (outcome, { data }) => {
            const clearProgress = data.progress?.during === 'submodule' ? { progress: null } : {};
            return {
              data: {
                ...clearProgress,
                updatingSubmodule: null,
                ...(outcome.ok ? {} : failureShown(outcome.failure)),
              },
            };
          },
        }),
        diff: each('code', 'commit.GET_GIT_DIFF', {
          args: (_tab, input) => input,
          done: (outcome, { data, report }) => {
            if (!outcome.ok) return { data: failureShown(outcome.failure) };
            const diff = outcome.value;
            report({ type: 'OPEN_DIFF_TAB', diff });
            const nextApplied = withoutAppliedHunks(data.appliedHunks, diffTabPath(diff));
            return nextApplied ? { data: { appliedHunks: nextApplied } } : undefined;
          },
        }),
        diffRefresh: each('code', 'commit.GET_GIT_DIFF', {
          args: (_tab, input) => input,
          done: (outcome, { data, report }) => {
            if (!outcome.ok) return;
            const diff = outcome.value;
            report({ type: 'REFRESH_DIFF_TAB', diff });
            const nextApplied = withoutAppliedHunks(data.appliedHunks, diffTabPath(diff));
            return nextApplied ? { data: { appliedHunks: nextApplied } } : undefined;
          },
        }),
      }),
      on: {
        'commit.VIEW_DIFF': ({ path, staged }, { data, cancel, call, report }) => {
          const tab = diffTabPath({ path, staged });
          if (data.openDiffs.some((d) => d.tab === tab)) {
            report({ type: 'ACTIVATE_DIFF_TAB', tab });
            cancel('diffRefresh', tab);
            call('diffRefresh', tab, { path, staged });
            return;
          }
          cancel('diff', tab);
          call('diff', tab, { path, staged });
        },
        CODE_STARTED: ({ directory }, { data, tell, child }) => {
          if (!directory) {
            return { at: 'closed', data: { appliedHunks: {}, commitMessage: '', isGeneratingMessage: false } };
          }
          if (directory !== data.directory) {
            return {
              at: 'open',
              data: { ...openInitialData(directory), appliedHunks: {}, commitMessage: '', isGeneratingMessage: false },
            };
          }
          // Same folder (e.g., reconnect): keep current state and refresh lists
          tell(child('stashes'), { type: 'STASH_LIST' });
          tell(child('worktrees'), { type: 'WORKTREE_LIST' });
          tell(child('remotes'), { type: 'GET_ALL_BRANCHES' });
          tell(child('history'), { type: 'LOG_LIST' });
          return {
            data: {
              statusRev: data.statusRev + 1,
              statusLoadingShown: true,
              reposRev: data.reposRev + 1,
            },
          };
        },
        'commit.SHOWN': (_event, { data, tell, child, cancel, call }) => {
          const missed = data.missedChange;
          if (!missed) return { data: { isShown: true } };
          if (missed.history || missed.refs) tell(child('history'), { type: 'LOG_LIST' });
          if (missed.stashes) tell(child('stashes'), { type: 'STASH_LIST' });
          if (missed.worktrees) tell(child('worktrees'), { type: 'WORKTREE_LIST' });
          if (missed.diffs) {
            if (!missed.status) {
              for (const path of Object.keys(data.openFolders)) {
                if (!missed.files || missed.files.includes(path)) {
                  cancel('untracked', path);
                  call('untracked', path);
                }
              }
            }
            for (const d of data.openDiffs) {
              if (
                missed.files &&
                !missed.files.some((named) => named === d.path || (named.endsWith('/') && d.path.startsWith(named)))
              ) {
                continue;
              }
              cancel('diffRefresh', d.tab);
              call('diffRefresh', d.tab, { path: d.path, staged: d.staged });
            }
          }
          return {
            data: {
              isShown: true,
              missedChange: null,
              ...(missed.status ? { statusRev: data.statusRev + 1 } : {}),
            },
          };
        },
        'commit.SELECT_FILE': ({ file }) => ({ data: { selectedGitFile: file } }),
        'commit.CLEAR_DIFF': () => ({ data: { selectedGitFile: null } }),
        'commit.UPDATE_MESSAGE': ({ message }, { tell, child }) => {
          tell(child('composer'), { type: 'MESSAGE_CHANGED', message });
          return { data: { commitMessage: message } };
        },
        'commit.MESSAGE_GENERATED': ({ data: { message } }, { tell, child }) => {
          tell(child('composer'), { type: 'MESSAGE_CHANGED', message });
          return { data: { isGeneratingMessage: false, commitMessage: message } };
        },
        'commit.MESSAGE_NOT_GENERATED': ({ data: { message } }) => ({
          data: { gitError: message, gitFailure: {}, isGeneratingMessage: false },
        }),
        'commit.REFRESH_STATUS': (_event, { data }) => ({
          data: { statusRev: data.statusRev + 1, statusLoadingShown: true },
        }),
        'commit.READ_STATUS': (_event, { data }) => ({
          data: { statusRev: data.statusRev + 1 },
        }),
        'commit.REPOSITORY_CHANGED': ({ changed }, { data, tell, child, cancel, call }) => {
          if (!data.isShown) {
            return { data: { missedChange: bothChanges(data.missedChange, changed) } };
          }
          if (changed.history || changed.refs) tell(child('history'), { type: 'LOG_LIST' });
          if (changed.stashes) tell(child('stashes'), { type: 'STASH_LIST' });
          if (changed.worktrees) tell(child('worktrees'), { type: 'WORKTREE_LIST' });
          if (changed.diffs) {
            if (!changed.status) {
              for (const path of Object.keys(data.openFolders)) {
                if (!changed.files || changed.files.includes(path)) {
                  cancel('untracked', path);
                  call('untracked', path);
                }
              }
            }
            for (const d of data.openDiffs) {
              if (
                changed.files &&
                !changed.files.some((named) => named === d.path || (named.endsWith('/') && d.path.startsWith(named)))
              ) {
                continue;
              }
              cancel('diffRefresh', d.tab);
              call('diffRefresh', d.tab, { path: d.path, staged: d.staged });
            }
          }
          if (changed.status) {
            return { data: { statusRev: data.statusRev + 1 } };
          }
        },
        'commit.STAGE_FILES': ({ paths }, { data, call }) => {
          call('stage', paths);
          return { data: { gitStatus: withStaged([...(data.gitStatus as GitStatusFile[])], paths) } };
        },
        'commit.UNSTAGE_FILES': ({ paths }, { data, call }) => {
          call('unstage', paths);
          return { data: { gitStatus: withUnstaged([...(data.gitStatus as GitStatusFile[])], paths) } };
        },
        'commit.SHOW_BLAME': ({ path }) => ({
          data: { blamePath: path, blame: { path, lines: [] } },
        }),
        'commit.CLEAR_BLAME': () => ({ data: { blamePath: null, blame: null } }),
        'commit.TOGGLE_FOLDER': ({ path }, { data, cancel, call }) => {
          if (path in data.openFolders) {
            cancel('untracked', path);
            return {
              data: (d) => {
                delete d.openFolders[path];
              },
            };
          }
          cancel('untracked', path);
          call('untracked', path);
          return {
            data: (d) => {
              d.openFolders[path] = { files: [], truncated: false };
            },
          };
        },
        'commit.APPLY_HUNK': (ev, { cancel, call }) => {
          cancel('hunk');
          call('hunk', { path: ev.path, staged: ev.staged, hunk: ev.hunk });
          return { data: { gitError: null, gitFailure: null } };
        },
        'commit.SPEED_UP_STATUS': (_event, { cancel, call }) => {
          cancel('speedUp');
          call('speedUp');
        },
        'commit.UPDATE_SUBMODULE': ({ path }, { snapshot, call }) => {
          if (snapshot.pending.submodule) return;
          call('submodule', path);
          return { data: { updatingSubmodule: path, gitError: null, gitFailure: null } };
        },
        'commit.TRUST_REPOSITORY': ({ repository }, { data, call }) => {
          const target = repository ?? data.gitFailure?.trust?.repository;
          if (target) call('trustRepository', target);
        },
        'commit.TRUST_OWNERSHIP': (_event, { data, call }) => {
          if (data.gitFailure?.ownership) call('trustOwnership');
        },
        'commit.RESOLVE_CONFLICT': ({ path, strategy }, { call }) => {
          call('resolveConflict', { path, strategy });
        },
        'commit.MARK_RESOLVED': ({ path }, { call }) => {
          call('markResolved', path);
        },
        'commit.RESOLVE_ALL_CONFLICTS': ({ strategy }, { call }) => {
          call('resolveAllConflicts', strategy);
        },
        'commit.DISMISS_ERROR': () => ({ data: { gitError: null, gitFailure: null, statusFailed: false } }),

        // ── Forwarded events to the 6 children ──────────────────────────────────
        'commit.COMMIT': (_event, { data, tell, child }) => {
          tell(child('composer'), { type: 'COMMIT', message: data.commitMessage });
        },
        'commit.AMEND': ({ message, evenIfPublished }, { tell, child }) => {
          tell(child('composer'), { type: 'AMEND', message, evenIfPublished });
        },
        'commit.REMOVE_TRAILER': ({ trailer }, { data, tell, child }) => {
          tell(child('composer'), { type: 'REMOVE_TRAILER', message: data.commitMessage, trailer });
        },
        'commit.GENERATE_MESSAGE': (_event, { tell, child }) => {
          tell(child('composer'), { type: 'GENERATE_MESSAGE' });
          return { data: { isGeneratingMessage: true } };
        },
        'commit.CONFIRM_REWRITE': (_event, { tell, child }) => {
          tell(child('composer'), { type: 'CONFIRM_REWRITE' });
        },
        'commit.DISMISS_REWRITE': (_event, { tell, child }) => {
          tell(child('composer'), { type: 'DISMISS_REWRITE' });
        },
        'commit.TOGGLE_REVERT_DIALOG': ({ file }, { tell, child }) => {
          tell(child('recovery'), { type: 'TOGGLE_REVERT_DIALOG', file });
        },
        'commit.PREVIEW_DISCARD': ({ paths }, { tell, child }) => {
          tell(child('recovery'), { type: 'PREVIEW_DISCARD', paths });
        },
        'commit.REVERT_FILE': ({ path }, { tell, child }) => {
          tell(child('recovery'), { type: 'REVERT_FILE', path });
        },
        'commit.REVERT_FILES': ({ paths }, { tell, child }) => {
          tell(child('recovery'), { type: 'REVERT_FILES', paths });
        },
        'commit.UNDO_DISCARD': (_event, { tell, child }) => {
          tell(child('recovery'), { type: 'UNDO_DISCARD' });
        },
        'commit.DISMISS_DISCARD': (_event, { tell, child }) => {
          tell(child('recovery'), { type: 'DISMISS_DISCARD' });
        },
        'commit.UNDO_LAST': ({ evenIfPublished }, { tell, child }) => {
          tell(child('recovery'), { type: 'UNDO_LAST', evenIfPublished });
        },
        'commit.DISMISS_UNDO': (_event, { tell, child }) => {
          tell(child('recovery'), { type: 'DISMISS_UNDO' });
        },
        'commit.LOG_LIST': (_event, { tell, child }) => {
          tell(child('history'), { type: 'LOG_LIST' });
        },
        'commit.LOAD_MORE_LOG': (_event, { tell, child }) => {
          tell(child('history'), { type: 'LOAD_MORE_LOG' });
        },
        'commit.SHOW_FILE_HISTORY': ({ path }, { tell, child }) => {
          tell(child('history'), { type: 'SHOW_FILE_HISTORY', path });
        },
        'commit.CLEAR_FILE_HISTORY': (_event, { tell, child }) => {
          tell(child('history'), { type: 'CLEAR_FILE_HISTORY' });
        },
        'commit.START_REWORD': ({ hash }, { tell, child }) => {
          tell(child('history'), { type: 'START_REWORD', hash });
        },
        'commit.CANCEL_REWORD': (_event, { tell, child }) => {
          tell(child('history'), { type: 'CANCEL_REWORD' });
        },
        'commit.REWRITE_COMMIT': (ev, { tell, child }) => {
          tell(child('history'), {
            type: 'REWRITE_COMMIT',
            hash: ev.hash,
            action: ev.action,
            message: ev.message,
            evenIfPublished: ev.evenIfPublished,
          });
        },
        'commit.REVERT_COMMIT': ({ hash }, { tell, child }) => {
          tell(child('history'), { type: 'REVERT_COMMIT', hash });
        },
        'commit.RESET_TO_COMMIT': ({ hash }, { tell, child }) => {
          tell(child('history'), { type: 'RESET_TO_COMMIT', hash });
        },
        'commit.GET_ALL_BRANCHES': (_event, { tell, child }) => {
          tell(child('remotes'), { type: 'GET_ALL_BRANCHES' });
        },
        'commit.UPDATE_BRANCH_INPUT': ({ input }, { tell, child }) => {
          tell(child('remotes'), { type: 'UPDATE_BRANCH_INPUT', input });
        },
        'commit.PREVIEW_MERGE': ({ target }, { tell, child }) => {
          tell(child('remotes'), { type: 'PREVIEW_MERGE', target });
        },
        'commit.PUSH_BRANCH': (_event, { tell, child }) => {
          tell(child('remotes'), { type: 'PUSH_BRANCH' });
        },
        'commit.STOP_PUSH': (_event, { tell, child }) => {
          tell(child('remotes'), { type: 'STOP_PUSH' });
        },
        'commit.PULL_BRANCH': (_event, { tell, child }) => {
          tell(child('remotes'), { type: 'PULL_BRANCH' });
        },
        'commit.CHECKOUT_BRANCH': ({ branchName, pull }, { tell, child }) => {
          tell(child('remotes'), { type: 'CHECKOUT_BRANCH', branchName, pull });
        },
        'commit.CREATE_BRANCH': ({ branchName }, { tell, child }) => {
          tell(child('remotes'), { type: 'CREATE_BRANCH', branchName });
        },
        'commit.SET_UP_SIGN_IN': ({ host }, { data, tell, child }) => {
          tell(child('remotes'), { type: 'SET_UP_SIGN_IN', host, during: data.gitFailure?.during });
        },
        'commit.MOVE_OPERATION': ({ move }, { tell, child }) => {
          tell(child('remotes'), { type: 'MOVE_OPERATION', move });
        },
        'commit.START_OPERATION': ({ kind, target }, { tell, child }) => {
          tell(child('remotes'), { type: 'START_OPERATION', kind, target });
        },
        'commit.PUSH_TAG': ({ name }, { tell, child }) => {
          tell(child('remotes'), { type: 'PUSH_TAG', name });
        },
        'commit.DELETE_TAG': ({ name }, { tell, child }) => {
          tell(child('remotes'), { type: 'DELETE_TAG', name });
        },
        'commit.RENAME_BRANCH': ({ name, to }, { tell, child }) => {
          tell(child('remotes'), { type: 'RENAME_BRANCH', name, to });
        },
        'commit.CREATE_TAG': ({ name, commit, message }, { tell, child }) => {
          tell(child('remotes'), { type: 'CREATE_TAG', name, commit, message });
        },
        'commit.STASH_LIST': (_event, { tell, child }) => {
          tell(child('stashes'), { type: 'STASH_LIST' });
        },
        'commit.TOGGLE_STASH_FILES': ({ index }, { tell, child }) => {
          tell(child('stashes'), { type: 'TOGGLE_STASH_FILES', index });
        },
        'commit.STASH_PUSH': ({ message, stagedOnly, paths }, { data, tell, child }) => {
          tell(child('stashes'), {
            type: 'STASH_PUSH',
            message,
            stagedOnly,
            paths,
            takesMessage: !!message && message === data.commitMessage,
          });
        },
        'commit.STASH_APPLY': ({ index }, { tell, child }) => {
          tell(child('stashes'), { type: 'STASH_APPLY', index });
        },
        'commit.STASH_POP': ({ index }, { tell, child }) => {
          tell(child('stashes'), { type: 'STASH_POP', index });
        },
        'commit.STASH_DROP': ({ index }, { tell, child }) => {
          tell(child('stashes'), { type: 'STASH_DROP', index });
        },
        'commit.STASH_CLEAR': (_event, { tell, child }) => {
          tell(child('stashes'), { type: 'STASH_CLEAR' });
        },
        'commit.WORKTREE_LIST': (_event, { tell, child }) => {
          tell(child('worktrees'), { type: 'WORKTREE_LIST' });
        },
        'commit.WORKTREE_ADD': (ev, { tell, child }) => {
          tell(child('worktrees'), { type: 'WORKTREE_ADD', path: ev.path, branch: ev.branch, createBranch: ev.createBranch });
        },
        'commit.WORKTREE_REMOVE': (ev, { tell, child }) => {
          tell(child('worktrees'), { type: 'WORKTREE_REMOVE', path: ev.path, force: ev.force });
        },
        'commit.WORKTREE_SWITCH': ({ path }, { tell, child }) => {
          tell(child('worktrees'), { type: 'WORKTREE_SWITCH', path });
        },

        // ── Reports from the 6 children ─────────────────────────────────────────
        CHILD_ERROR: ({ failure }) => ({ data: failureShown(failure) }),
        CHILD_CLEAR_ERROR: () => ({ data: { gitError: null, gitFailure: null } }),
        CHILD_UNDOABLE: ({ undoable }, { tell, child }) => {
          tell(child('recovery'), { type: 'SET_UNDOABLE', undoable });
        },
        CLEAR_COMMIT_MESSAGE: ({ clearSelection }, { tell, child }) => {
          tell(child('composer'), { type: 'MESSAGE_CHANGED', message: '' });
          return {
            data: {
              commitMessage: '',
              ...(clearSelection ? { selectedGitFile: null } : {}),
            },
          };
        },
        SET_COMMIT_MESSAGE: ({ message, expectedMessage }, { data }) => {
          if (expectedMessage !== undefined && data.commitMessage !== expectedMessage) return;
          return { data: { commitMessage: message } };
        },
        GENERATE_MESSAGE_FAILED: () => ({ data: { isGeneratingMessage: false } }),
        REQUEST_STATUS_REFRESH: (_event, { data }) => ({ data: { statusRev: data.statusRev + 1 } }),
        REQUEST_LOG_REFRESH: (_event, { tell, child }) => {
          tell(child('history'), { type: 'LOG_LIST' });
        },
        CHILD_PROGRESS: ({ progress }) => ({ data: { progress } }),
        CHILD_CLEAR_PROGRESS: ({ during }, { data }) =>
          data.progress?.during === during ? { data: { progress: null } } : undefined,
        CHILD_PUBLISHED_REWRITE: ({ message, request }, { tell, child }) => {
          tell(child('composer'), { type: 'SET_REWRITE_CONFIRMATION', message, request });
        },
        CONFIRMED_HISTORY_REWRITE: ({ request }, { tell, child }) => {
          tell(child('history'), {
            type: 'REWRITE_COMMIT',
            hash: request.hash,
            action: request.action,
            message: request.message,
            evenIfPublished: true,
          });
        },
      },
    },
  },
});
