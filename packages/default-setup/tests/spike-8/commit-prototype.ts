import { given, state as standaloneState, type Read } from '@apackdev/state';
import { state } from '#generated/state.ts';
import type { CommitStatus } from '#features/code/be/contract.ts';
import type {
  BlameLine,
  ChangedFile,
  CommitTrailer,
  GitDiff,
  GitProgress,
  GitStatusFile,
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

/**
 * Phase 2 #8 Spike — Faithful 7-state FE decomposition of `code/fe/commit` (56/56 `made` entries, 54 asks)
 * bound against the real generated `PackNet` (`#generated/state.ts`), plus the `code/be/commit` `statusRefresh`
 * + `writeDebounce` backend state machine.
 */

// ── Shared FE helper types ────────────────────────────────────────────────────────────────────────

export type OpenDiffRef = { tab: string; path: string; staged: boolean };

export type RewriteRequest =
  | { type: 'commit.AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'commit.REWRITE_COMMIT'; hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean };

export type CommitReport =
  | { type: 'OPEN_DIFF_TAB'; diff: GitDiff }
  | { type: 'UPDATE_DIFF_TAB'; tab: string; diff: GitDiff }
  | { type: 'OPEN_FILE_TAB'; file: GitStatusFile }
  | { type: 'SELECT_REPOSITORY_PATH'; path: string };

export type CommitChildReport =
  | { type: 'CHILD_ERROR'; message: string }
  | { type: 'CHILD_UNDOABLE'; undoable: { id: string; summary: string } | null }
  | { type: 'CLEAR_COMMIT_MESSAGE' }
  | { type: 'SET_COMMIT_MESSAGE'; message: string }
  | { type: 'REQUEST_STATUS_REFRESH' }
  | { type: 'WORKTREE_SWITCHED'; path: string };

export function trailerParagraph(message: string): string | undefined {
  const paragraphs = message.split(/\r?\n\s*\r?\n/).filter((p) => p.trim());
  return paragraphs.length > 1 ? paragraphs.at(-1) : undefined;
}

const bothChanges = (one: RepositoryChange | null, other: RepositoryChange): RepositoryChange => {
  if (!one) return other;
  const named = (change: RepositoryChange) => !change.diffs || change.files !== undefined;
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

// ── 1. `composer` child (1 load, 4 calls) ─────────────────────────────────────────────────────────

type ComposerShape = {
  data: {
    trailersMessage: string;
    trailersParagraph: string | null;
    trailers: CommitTrailer[];
    rewriteConfirmation: { message: string; request: RewriteRequest } | null;
    pendingRewrite: RewriteRequest | null;
    lastCommittedMessage: string | null;
  };
  reports: CommitChildReport;
  calls: {
    commit: { one: { message: string } };
    amend: { one: { message?: string; evenIfPublished?: boolean } };
    removeTrailer: { many: { message: string; trailer: CommitTrailer } };
    generateMessage: 'many';
  };
};

type ComposerEvent =
  | { type: 'MESSAGE_CHANGED'; message: string }
  | { type: 'COMMIT'; message: string }
  | { type: 'AMEND'; message?: string; evenIfPublished?: boolean }
  | { type: 'CONFIRM_REWRITE' }
  | { type: 'DISMISS_REWRITE' }
  | { type: 'REMOVE_TRAILER'; message: string; trailer: CommitTrailer }
  | { type: 'GENERATE_MESSAGE' };

export const composerState = state<ComposerShape, ComposerEvent>()({
  data: {
    trailersMessage: '',
    trailersParagraph: null,
    trailers: [],
    rewriteConfirmation: null,
    pendingRewrite: null,
    lastCommittedMessage: null,
  },
  loads: (load) => ({
    trailers: load('code', 'commit.READ_TRAILERS', {
      from: ['trailersParagraph', 'trailersMessage'],
      args: ({ trailersParagraph, trailersMessage }) =>
        trailersParagraph ? { message: trailersMessage } : null,
      done: (outcome, { data }) => {
        if (!outcome.ok) return;
        if (outcome.value.message !== data.trailersMessage) return;
        return { data: { trailers: outcome.value.trailers } };
      },
    }),
  }),
  calls: ({ one, many }) => ({
    commit: one('code', 'commit.COMMIT', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        report({ type: 'CLEAR_COMMIT_MESSAGE' });
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        return { data: { lastCommittedMessage: outcome.value.message, trailers: [] } };
      },
    }),
    amend: one('code', 'commit.AMEND', {
      args: (input) => input,
      done: (outcome, { input, report }) => {
        if (!outcome.ok) {
          if (outcome.failure.kind === 'published') {
            return {
              data: {
                rewriteConfirmation: {
                  message: outcome.failure.message,
                  request: { type: 'commit.AMEND', message: input.message, evenIfPublished: true },
                },
              },
            };
          }
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        return { data: { rewriteConfirmation: null, pendingRewrite: null } };
      },
    }),
    removeTrailer: many('code', 'commit.REMOVE_TRAILER', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        report({ type: 'SET_COMMIT_MESSAGE', message: outcome.value.without });
      },
    }),
    generateMessage: many('code', 'commit.GENERATE_MESSAGE', {
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
  }),
  on: {
    MESSAGE_CHANGED: ({ message }) => ({
      data: {
        trailersMessage: message,
        trailersParagraph: trailerParagraph(message) ?? null,
        ...(trailerParagraph(message) ? {} : { trailers: [] }),
      },
    }),
    COMMIT: ({ message }, { call }) => {
      call('commit', { message });
    },
    AMEND: ({ message, evenIfPublished }, { call }) => {
      call('amend', { message, evenIfPublished });
    },
    CONFIRM_REWRITE: (_, { data, call }) => {
      const req = data.rewriteConfirmation?.request;
      if (req && req.type === 'commit.AMEND') {
        call('amend', { message: req.message, evenIfPublished: true });
        return { data: { rewriteConfirmation: null, pendingRewrite: req } };
      }
    },
    DISMISS_REWRITE: () => ({ data: { rewriteConfirmation: null, pendingRewrite: null } }),
    REMOVE_TRAILER: ({ message, trailer }, { call }) => {
      call('removeTrailer', { message, trailer });
    },
    GENERATE_MESSAGE: (_, { call }) => {
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
    revertFile: { many: string };
    revertFiles: { many: string[] };
    restoreDiscarded: { many: string };
    undoLast: { many: { evenIfPublished?: boolean } };
  };
};

type RecoveryEvent =
  | { type: 'TOGGLE_REVERT_DIALOG'; file?: GitStatusFile }
  | { type: 'PREVIEW_DISCARD'; paths: string[] }
  | { type: 'REVERT_FILE'; path: string }
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
      done: (outcome) => {
        if (!outcome.ok) return;
        return { data: { discardPreview: outcome.value } };
      },
    }),
  }),
  calls: ({ many }) => ({
    revertFile: many('code', 'commit.REVERT_FILE', {
      args: (path) => ({ path }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        const { path, kept } = outcome.value;
        return {
          data: {
            revertDialogFile: null,
            lastDiscard: kept.id ? { id: kept.id, paths: [path], notKept: kept.notKept } : null,
          },
        };
      },
    }),
    revertFiles: many('code', 'commit.REVERT_FILES', {
      args: (paths) => ({ paths }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        const { paths, kept } = outcome.value;
        return {
          data: {
            lastDiscard: kept.id ? { id: kept.id, paths, notKept: kept.notKept } : null,
          },
        };
      },
    }),
    restoreDiscarded: many('code', 'commit.RESTORE_DISCARDED', {
      args: (id) => ({ id }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        return { data: { lastDiscard: null, discardLeft: outcome.value.left } };
      },
    }),
    undoLast: many('code', 'commit.UNDO_LAST', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          if (outcome.failure.kind === 'published') {
            return { data: { undoConfirmation: outcome.failure.message } };
          }
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        return {
          data: {
            undoConfirmation: null,
            lastUndoable: outcome.value.undoable ?? null,
          },
        };
      },
    }),
  }),
  on: {
    TOGGLE_REVERT_DIALOG: ({ file }) => ({ data: { revertDialogFile: file ?? null } }),
    PREVIEW_DISCARD: ({ paths }) => ({ data: { discardPreviewPaths: paths } }),
    REVERT_FILE: ({ path }, { call }) => {
      call('revertFile', path);
    },
    REVERT_FILES: ({ paths }, { call }) => {
      call('revertFiles', paths);
    },
    UNDO_DISCARD: (_, { data, call }) => {
      if (data.lastDiscard) call('restoreDiscarded', data.lastDiscard.id);
    },
    DISMISS_DISCARD: () => ({ data: { lastDiscard: null, discardLeft: [] } }),
    UNDO_LAST: ({ evenIfPublished }, { call }) => {
      call('undoLast', { evenIfPublished });
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
    commitLog: HistoryCommit[];
    logCursor: string | null;
    rewordHash: string | null;
    rewording: { hash: string; message: string | null } | null;
    resettingTo: string | null;
  };
  reports: CommitChildReport;
  calls: {
    rewrite: { many: { hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean } };
    revertCommit: { many: string };
    reset: { one: string };
  };
};

type HistoryEvent =
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
      done: (outcome, { data }) => {
        if (!outcome.ok) return;
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
      done: (outcome) => {
        if (!outcome.ok) return { data: { rewording: null, rewordHash: null } };
        return { data: { rewording: { hash: outcome.value.hash, message: outcome.value.message } } };
      },
    }),
  }),
  calls: ({ one, many }) => ({
    rewrite: many('code', 'commit.REWRITE_COMMIT', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        return { data: { rewording: null, rewordHash: null } };
      },
    }),
    revertCommit: many('code', 'commit.REVERT_COMMIT', {
      args: (hash) => ({ hash }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    reset: one('code', 'commit.RESET_TO_COMMIT', {
      args: (hash) => ({ hash }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        } else if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
        return { data: { resettingTo: null } };
      },
    }),
  }),
  on: {
    LOG_LIST: (_, { data }) => ({ data: { logRev: data.logRev + 1, logLoadCursor: null } }),
    LOAD_MORE_LOG: (_, { data }) => (data.logCursor ? { data: { logLoadCursor: data.logCursor } } : undefined),
    SHOW_FILE_HISTORY: ({ path }, { data }) => ({
      data: { logPath: path, logLoadCursor: null, logRev: data.logRev + 1 },
    }),
    CLEAR_FILE_HISTORY: (_, { data }) => ({
      data: { logPath: null, logLoadCursor: null, logRev: data.logRev + 1 },
    }),
    START_REWORD: ({ hash }) => ({ data: { rewordHash: hash, rewording: { hash, message: null } } }),
    CANCEL_REWORD: () => ({ data: { rewordHash: null, rewording: null } }),
    REWRITE_COMMIT: (ev, { call }) => {
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
    progress: ({ during: ProgressDuring } & GitProgress) | null;
    pushStopped: boolean;
    lastPushedBranch: string | null;
    tagBusy: { name: string; action: 'push' | 'delete' } | null;
    tagPushed: { name: string } | null;
  };
  reports: CommitChildReport;
  calls: {
    push: 'one';
    pull: 'one';
    checkout: { one: { branchName: string; pull?: boolean } };
    createBranch: { one: string };
    signIn: { one: { host: string; during?: 'push' | 'pull' } };
    moveOperation: { one: OperationMove };
    startOperation: { one: { kind: StartableOperation; target: string } };
    tagPush: { one: string };
    tagDelete: { one: string };
    renameBranch: { many: { name: string; to: string } };
    createTag: { many: { name: string; commit?: string; message?: string } };
  };
};

type RemotesEvent =
  | { type: 'GET_ALL_BRANCHES' }
  | { type: 'UPDATE_BRANCH_INPUT'; input: string }
  | { type: 'PREVIEW_MERGE'; target: string }
  | { type: 'PUSH_BRANCH' }
  | { type: 'STOP_PUSH' }
  | { type: 'PULL_BRANCH' }
  | { type: 'CHECKOUT_BRANCH'; branchName: string; pull?: boolean }
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
    progress: null,
    pushStopped: false,
    lastPushedBranch: null,
    tagBusy: null,
    tagPushed: null,
  },
  loads: (load) => ({
    branches: load('code', 'commit.GET_ALL_BRANCHES', {
      from: ['branchesRev'],
      done: (outcome) => {
        if (!outcome.ok) return;
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
      done: (outcome) => {
        if (!outcome.ok) return;
        return { data: { mergePreview: outcome.value } };
      },
    }),
  }),
  calls: ({ one, many }) => ({
    push: one('code', 'commit.PUBLISH_BRANCH', {
      progress: (updates) => {
        const latest = updates.at(-1);
        return latest ? { data: { progress: latest } } : undefined;
      },
      done: (outcome, { data, report }) => {
        const clearProgress = data.progress?.during === 'push' ? { progress: null } : {};
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return { data: clearProgress };
        }
        return { data: { ...clearProgress, pushStopped: false, lastPushedBranch: outcome.value.branchName } };
      },
    }),
    pull: one('code', 'commit.PULL_BRANCH', {
      progress: (updates) => {
        const latest = updates.at(-1);
        return latest ? { data: { progress: latest } } : undefined;
      },
      done: (outcome, { data, report }) => {
        const clearProgress = data.progress?.during === 'pull' ? { progress: null } : {};
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        return { data: clearProgress };
      },
    }),
    checkout: one('code', 'commit.CHECKOUT_BRANCH', {
      args: (input) => input,
      progress: (updates) => {
        const latest = updates.at(-1);
        return latest ? { data: { progress: latest } } : undefined;
      },
      done: (outcome, { data, report }) => {
        const clearProgress = data.progress?.during === 'checkout' ? { progress: null } : {};
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        return { data: clearProgress };
      },
    }),
    createBranch: one('code', 'commit.CREATE_BRANCH', {
      args: (branchName) => ({ branchName }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    signIn: one('code', 'commit.SET_UP_SIGN_IN', {
      args: (input) => input,
      done: (outcome, { call, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        if (outcome.value.during === 'push') call('push');
        if (outcome.value.during === 'pull') call('pull');
      },
    }),
    moveOperation: one('code', 'commit.MOVE_OPERATION', {
      args: (move) => ({ move }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    startOperation: one('code', 'commit.START_OPERATION', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return;
        }
        if (outcome.value.undoable !== undefined) {
          report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
        }
      },
    }),
    tagPush: one('code', 'commit.PUSH_TAG', {
      args: (name) => ({ name }),
      done: (outcome, { report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return { data: { tagBusy: null } };
        }
        return { data: { tagBusy: null, tagPushed: { name: outcome.value.name } } };
      },
    }),
    tagDelete: one('code', 'commit.DELETE_TAG', {
      args: (name) => ({ name }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        return { data: { tagBusy: null } };
      },
    }),
    renameBranch: many('code', 'commit.RENAME_BRANCH', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    createTag: many('code', 'commit.CREATE_TAG', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
  }),
  on: {
    GET_ALL_BRANCHES: (_, { data }) => ({ data: { branchesRev: data.branchesRev + 1 } }),
    UPDATE_BRANCH_INPUT: ({ input }) => ({ data: { branchInput: input } }),
    PREVIEW_MERGE: ({ target }) => ({ data: { mergePreviewTarget: target } }),
    PUSH_BRANCH: (_, { call }) => {
      call('push');
      return { data: { pushStopped: false } };
    },
    STOP_PUSH: (_, { cancel, data }) => {
      cancel('push');
      return {
        data: {
          pushStopped: true,
          ...(data.progress?.during === 'push' ? { progress: null } : {}),
        },
      };
    },
    PULL_BRANCH: (_, { call }) => {
      call('pull');
    },
    CHECKOUT_BRANCH: ({ branchName, pull }, { cancel, call }) => {
      cancel('checkout');
      call('checkout', { branchName, pull });
    },
    CREATE_BRANCH: ({ branchName }, { cancel, call }) => {
      cancel('createBranch');
      call('createBranch', branchName);
    },
    SET_UP_SIGN_IN: ({ host, during }, { call }) => {
      call('signIn', { host, during });
    },
    MOVE_OPERATION: ({ move }, { call }) => {
      call('moveOperation', move);
    },
    START_OPERATION: ({ kind, target }, { call }) => {
      call('startOperation', { kind, target });
    },
    PUSH_TAG: ({ name }, { cancel, call }) => {
      cancel('tagPush');
      call('tagPush', name);
      return { data: { tagBusy: { name, action: 'push' } } };
    },
    DELETE_TAG: ({ name }, { cancel, call }) => {
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
    stash: { one: { message?: string; stagedOnly?: boolean; paths?: string[] } };
    stashApply: { many: number };
    stashPop: { many: number };
    stashDrop: { many: number };
    stashClear: 'many';
  };
};

type StashesEvent =
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
      done: (outcome) => {
        if (!outcome.ok) return;
        return { data: { stashList: outcome.value.stashes } };
      },
    }),
  }),
  calls: ({ one, each, many }) => ({
    stashFiles: each('code', 'commit.GET_STASH_CHANGES', {
      args: (key) => ({ index: Number(key) }),
      done: (outcome, { key }) => {
        if (!outcome.ok) return;
        return { data: (d) => { d.stashFiles[key] = outcome.value.files; } };
      },
    }),
    stash: one('code', 'commit.STASH_PUSH', {
      args: (input) => input,
      done: (outcome, { data, report }) => {
        if (!outcome.ok) {
          report({ type: 'CHILD_ERROR', message: outcome.failure.message });
          return { data: { stashTakesMessage: false } };
        }
        if (data.stashTakesMessage) report({ type: 'CLEAR_COMMIT_MESSAGE' });
        return { data: { stashTakesMessage: false } };
      },
    }),
    stashApply: many('code', 'commit.STASH_APPLY', {
      args: (index) => ({ index }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    stashPop: many('code', 'commit.STASH_POP', {
      args: (index) => ({ index }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    stashDrop: many('code', 'commit.STASH_DROP', {
      args: (index) => ({ index }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        else if (outcome.value.undoable !== undefined) report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
      },
    }),
    stashClear: many('code', 'commit.STASH_CLEAR', {
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        else if (outcome.value.undoable !== undefined) report({ type: 'CHILD_UNDOABLE', undoable: outcome.value.undoable });
      },
    }),
  }),
  on: {
    STASH_LIST: (_, { data }) => ({ data: { stashesRev: data.stashesRev + 1 } }),
    TOGGLE_STASH_FILES: ({ index }, { data, cancel, call }) => {
      const key = String(index);
      if (key in data.stashFiles) {
        cancel('stashFiles', key);
        return { data: (d) => { delete d.stashFiles[key]; } };
      }
      cancel('stashFiles', key);
      call('stashFiles', key);
    },
    STASH_PUSH: ({ message, stagedOnly, paths, takesMessage }, { call }) => {
      call('stash', { message, stagedOnly, paths });
      return { data: { stashTakesMessage: takesMessage === true } };
    },
    STASH_APPLY: ({ index }, { call }) => { call('stashApply', index); },
    STASH_POP: ({ index }, { call }) => { call('stashPop', index); },
    STASH_DROP: ({ index }, { call }) => { call('stashDrop', index); },
    STASH_CLEAR: (_, { call }) => { call('stashClear'); },
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
    worktreeAdd: { one: { path: string; branch?: string; createBranch?: boolean } };
    worktreeRemove: { one: { path: string; force?: boolean } };
    worktreeSwitch: { one: string };
  };
};

type WorktreesEvent =
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
      done: (outcome) => {
        if (!outcome.ok) return;
        return { data: { worktreeList: outcome.value.worktrees } };
      },
    }),
  }),
  calls: ({ one }) => ({
    worktreeAdd: one('code', 'commit.WORKTREE_ADD', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    worktreeRemove: one('code', 'commit.WORKTREE_REMOVE', {
      args: (input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
      },
    }),
    worktreeSwitch: one('code', 'commit.WORKTREE_SWITCH', {
      args: (path) => ({ path }),
      done: (outcome, { report }) => {
        if (!outcome.ok) report({ type: 'CHILD_ERROR', message: outcome.failure.message });
        else report({ type: 'WORKTREE_SWITCHED', path: outcome.value.path });
      },
    }),
  }),
  on: {
    WORKTREE_LIST: (_, { data }) => ({ data: { worktreesRev: data.worktreesRev + 1 } }),
    WORKTREE_ADD: (ev, { cancel, call }) => {
      cancel('worktreeAdd');
      call('worktreeAdd', { path: ev.path, branch: ev.branch, createBranch: ev.createBranch });
    },
    WORKTREE_REMOVE: (ev, { cancel, call }) => {
      cancel('worktreeRemove');
      call('worktreeRemove', { path: ev.path, force: ev.force });
    },
    WORKTREE_SWITCH: ({ path }, { cancel, call }) => {
      cancel('worktreeSwitch');
      call('worktreeSwitch', path);
    },
  },
});

// ── 7. `commit` root (2 calls) + `commit.open` (3 loads, 11 calls, 6 starts) ──────────────────────

export type CommitShape = {
  data: {
    isShown: boolean;
    commitMessage: string;
    appliedHunks: Record<string, string[]>;
    openDiffs: OpenDiffRef[];
    refreshedDiffs: Record<string, number>;
    isGeneratingMessage: boolean;
  };
  reports: CommitReport;
  calls: {
    diff: { each: { path: string; staged: boolean } };
    diffRefresh: { each: { path: string; staged: boolean } };
  };
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
        openFolders: Record<string, { files: string[]; truncated: boolean }>;
        updatingSubmodule: string | null;
        progress: ({ during: ProgressDuring } & GitProgress) | null;
      };
      calls: {
        stage: { many: string[] };
        unstage: { many: string[] };
        trustRepository: { many: string };
        trustOwnership: 'many';
        resolveConflict: { many: { path: string; strategy: 'ours' | 'theirs' } };
        markResolved: { many: string };
        resolveAllConflicts: { many: 'ours' | 'theirs' };
        untracked: 'each';
        hunk: { one: { path: string; staged: boolean; hunk: string } };
        speedUp: 'one';
        submodule: { one: string };
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
  | { type: 'commit.TRUST_REPOSITORY'; repository: string }
  | { type: 'commit.TRUST_OWNERSHIP' }
  | { type: 'commit.RESOLVE_CONFLICT'; path: string; strategy: 'ours' | 'theirs' }
  | { type: 'commit.MARK_RESOLVED'; path: string }
  | { type: 'commit.RESOLVE_ALL_CONFLICTS'; strategy: 'ours' | 'theirs' }
  | { type: 'commit.PUSH_BRANCH' }
  | { type: 'commit.STOP_PUSH' }
  | { type: 'commit.DISMISS_ERROR' }
  | { type: 'commit.GENERATING_MESSAGE' }
  | { type: 'commit.MESSAGE_GENERATED'; data: { message: string } }
  | { type: 'commit.MESSAGE_NOT_GENERATED'; data: { message: string } }
  // Reports from the 6 children (forwarded by kernel with `from`)
  | (CommitChildReport & { from?: string });

const applyStatus = (
  status: Read<CommitStatus>,
  stagingUnderWay: boolean,
  currentFiles: Read<GitStatusFile[]>,
  currentError: string | null,
  statusFailed: boolean,
) => ({
  lineCounts: Object.fromEntries((status.counts ?? []).map((c) => [`${c.staged}:${c.path}`, c])),
  gitStatus: stagingUnderWay ? [...currentFiles] : [...status.files],
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
  gitError: statusFailed ? null : currentError,
  statusFailed: false,
  statusLoadingShown: false,
});

export const commitState = state<CommitShape, CommitEvent>()({
  data: {
    isShown: true,
    commitMessage: '',
    appliedHunks: {},
    openDiffs: [],
    refreshedDiffs: {},
    isGeneratingMessage: false,
  },
  initial: 'closed',
  calls: ({ each }) => ({
    diff: each('code', 'commit.GET_GIT_DIFF', {
      args: (_tab, input) => input,
      done: (outcome, { report }) => {
        if (!outcome.ok) return;
        report({ type: 'OPEN_DIFF_TAB', diff: outcome.value });
      },
    }),
    diffRefresh: each('code', 'commit.GET_GIT_DIFF', {
      args: (_tab, input) => input,
      done: (outcome, { key, report }) => {
        if (!outcome.ok) return;
        report({ type: 'UPDATE_DIFF_TAB', tab: key, diff: outcome.value });
        return {
          data: (d) => {
            delete d.appliedHunks[key];
            d.refreshedDiffs[key] = (d.refreshedDiffs[key] ?? 0) + 1;
          },
        };
      },
    }),
  }),
  on: {
    CODE_STARTED: ({ directory }) => ({
      at: 'open',
      data: {
        directory,
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
    }),
    OPEN_DIFFS_CHANGED: ({ openDiffs }) => ({ data: { openDiffs: [...openDiffs] } }),
    'commit.SHOWN': () => ({ data: { isShown: true } }),
    'commit.HIDDEN': () => ({ data: { isShown: false } }),
    'commit.UPDATE_MESSAGE': ({ message }) => ({ data: { commitMessage: message } }),
    'commit.VIEW_DIFF': ({ path, staged }, { cancel, call }) => {
      const tab = `${staged ? 'staged' : 'unstaged'}:${path}`;
      cancel('diff', tab);
      call('diff', tab, { path, staged });
    },
    'commit.GENERATING_MESSAGE': () => ({ data: { isGeneratingMessage: true } }),
    'commit.MESSAGE_GENERATED': ({ data: { message } }) => ({
      data: { isGeneratingMessage: false, commitMessage: message },
    }),
    'commit.MESSAGE_NOT_GENERATED': () => ({ data: { isGeneratingMessage: false } }),
    CLEAR_COMMIT_MESSAGE: () => ({ data: { commitMessage: '' } }),
    SET_COMMIT_MESSAGE: ({ message }) => ({ data: { commitMessage: message } }),
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
          done: (outcome, { data, snapshot }) => {
            if (!outcome.ok) {
              return { data: { gitError: outcome.failure.message, statusFailed: true, statusLoadingShown: false } };
            }
            const stagingUnderWay = snapshot.pending.stage + snapshot.pending.unstage > 0;
            return {
              data: applyStatus(
                outcome.value,
                stagingUnderWay,
                data.gitStatus,
                data.gitError,
                data.statusFailed,
              ),
            };
          },
        }),
        repositories: load('code', 'commit.LIST_REPOSITORIES', {
          from: ['reposRev'],
          done: (outcome) => {
            if (!outcome.ok) return;
            return { data: { repositories: outcome.value.repositories } };
          },
        }),
        blame: load('code', 'commit.GET_BLAME', {
          from: ['blamePath'],
          args: ({ blamePath }) => (blamePath ? { path: blamePath } : null),
          done: (outcome) => {
            if (!outcome.ok) return { data: { blame: null } };
            return { data: { blame: outcome.value } };
          },
        }),
      }),
      calls: ({ one, each, many }) => ({
        stage: many('code', 'commit.STAGE_FILES', {
          args: (paths) => ({ paths }),
          done: (outcome, { data, snapshot }) => {
            if (!outcome.ok) {
              return { data: { gitError: outcome.failure.message, statusRev: data.statusRev + 1 } };
            }
            if (snapshot.pending.stage + snapshot.pending.unstage === 0) {
              return { data: { statusRev: data.statusRev + 1 } };
            }
          },
        }),
        unstage: many('code', 'commit.UNSTAGE_FILES', {
          args: (paths) => ({ paths }),
          done: (outcome, { data, snapshot }) => {
            if (!outcome.ok) {
              return { data: { gitError: outcome.failure.message, statusRev: data.statusRev + 1 } };
            }
            if (snapshot.pending.stage + snapshot.pending.unstage === 0) {
              return { data: { statusRev: data.statusRev + 1 } };
            }
          },
        }),
        trustRepository: many('code', 'commit.TRUST_REPOSITORY', {
          args: (repository) => ({ repository }),
          done: (outcome, { data }) =>
            outcome.ok ? { data: { statusRev: data.statusRev + 1 } } : { data: { gitError: outcome.failure.message } },
        }),
        trustOwnership: many('code', 'commit.TRUST_OWNERSHIP', {
          done: (outcome, { data }) =>
            outcome.ok ? { data: { statusRev: data.statusRev + 1 } } : { data: { gitError: outcome.failure.message } },
        }),
        resolveConflict: many('code', 'commit.RESOLVE_CONFLICT', {
          args: (input) => input,
          done: (outcome) => (outcome.ok ? undefined : { data: { gitError: outcome.failure.message } }),
        }),
        markResolved: many('code', 'commit.MARK_RESOLVED', {
          args: (path) => ({ path }),
          done: (outcome) => (outcome.ok ? undefined : { data: { gitError: outcome.failure.message } }),
        }),
        resolveAllConflicts: many('code', 'commit.RESOLVE_ALL_CONFLICTS', {
          args: (strategy) => ({ strategy }),
          done: (outcome) => (outcome.ok ? undefined : { data: { gitError: outcome.failure.message } }),
        }),
        untracked: each('code', 'commit.LIST_UNTRACKED', {
          args: (path) => ({ path }),
          done: (outcome, { key }) => {
            if (!outcome.ok) return;
            return {
              data: (d) => {
                d.openFolders[key] = { files: outcome.value.files, truncated: outcome.value.truncated };
              },
            };
          },
        }),
        hunk: one('code', 'commit.APPLY_HUNK', {
          args: (input) => input,
          done: (outcome) => {
            if (!outcome.ok) return { data: { gitError: outcome.failure.message } };
            const tab = `${outcome.value.staged ? 'staged' : 'unstaged'}:${outcome.value.path}`;
            return {
              data: (d) => {
                const existing = d.appliedHunks[tab] ?? [];
                d.appliedHunks[tab] = [...existing, outcome.value.hunk];
              },
            };
          },
        }),
        speedUp: one('code', 'commit.SPEED_UP_STATUS', {
          done: (outcome, { data }) =>
            outcome.ok ? { data: { statusRev: data.statusRev + 1 } } : { data: { gitError: outcome.failure.message } },
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
                ...(outcome.ok ? {} : { gitError: outcome.failure.message }),
              },
            };
          },
        }),
      }),
      on: {
        'commit.SHOWN': (_, { data, tell, child, cancel, call }) => {
          const missed = data.missedChange;
          if (!missed) return { data: { isShown: true } };
          if (missed.history) tell(child('history'), { type: 'LOG_LIST' });
          if (missed.refs) tell(child('remotes'), { type: 'GET_ALL_BRANCHES' });
          if (missed.stashes) tell(child('stashes'), { type: 'STASH_LIST' });
          if (missed.worktrees) tell(child('worktrees'), { type: 'WORKTREE_LIST' });
          if (missed.diffs) {
            for (const d of data.openDiffs) {
              if (!missed.files || missed.files.includes(d.path)) {
                cancel('diffRefresh', d.tab);
                call('diffRefresh', d.tab, { path: d.path, staged: d.staged });
              }
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
        'commit.UPDATE_MESSAGE': ({ message }, { tell, child }) => {
          tell(child('composer'), { type: 'MESSAGE_CHANGED', message });
          return { data: { commitMessage: message } };
        },
        'commit.REFRESH_STATUS': (_, { data }) => ({
          data: { statusRev: data.statusRev + 1, statusLoadingShown: true },
        }),
        'commit.READ_STATUS': (_, { data }) => ({
          data: { statusRev: data.statusRev + 1, statusLoadingShown: false },
        }),
        'commit.REPOSITORY_CHANGED': ({ changed }, { data, tell, child, cancel, call }) => {
          if (!data.isShown) {
            return { data: { missedChange: bothChanges(data.missedChange, changed) } };
          }
          if (changed.history) tell(child('history'), { type: 'LOG_LIST' });
          if (changed.refs) tell(child('remotes'), { type: 'GET_ALL_BRANCHES' });
          if (changed.stashes) tell(child('stashes'), { type: 'STASH_LIST' });
          if (changed.worktrees) tell(child('worktrees'), { type: 'WORKTREE_LIST' });
          if (changed.diffs) {
            for (const d of data.openDiffs) {
              if (!changed.files || changed.files.includes(d.path)) {
                cancel('diffRefresh', d.tab);
                call('diffRefresh', d.tab, { path: d.path, staged: d.staged });
              }
            }
          }
          if (changed.status) {
            return { data: { statusRev: data.statusRev + 1, statusLoadingShown: false } };
          }
        },
        'commit.STAGE_FILES': ({ paths }, { data, call }) => {
          call('stage', paths);
          return { data: { gitStatus: withStaged([...data.gitStatus], paths) } };
        },
        'commit.UNSTAGE_FILES': ({ paths }, { data, call }) => {
          call('unstage', paths);
          return { data: { gitStatus: withUnstaged([...data.gitStatus], paths) } };
        },
        'commit.SHOW_BLAME': ({ path }) => ({ data: { blamePath: path } }),
        'commit.CLEAR_BLAME': () => ({ data: { blamePath: null, blame: null } }),
        'commit.TOGGLE_FOLDER': ({ path }, { data, cancel, call }) => {
          if (path in data.openFolders) {
            cancel('untracked', path);
            return { data: (d) => { delete d.openFolders[path]; } };
          }
          cancel('untracked', path);
          call('untracked', path);
        },
        'commit.APPLY_HUNK': (ev, { cancel, call }) => {
          cancel('hunk');
          call('hunk', { path: ev.path, staged: ev.staged, hunk: ev.hunk });
        },
        'commit.SPEED_UP_STATUS': (_, { call }) => { call('speedUp'); },
        'commit.UPDATE_SUBMODULE': ({ path }, { call }) => {
          call('submodule', path);
          return { data: { updatingSubmodule: path } };
        },
        'commit.TRUST_REPOSITORY': ({ repository }, { call }) => { call('trustRepository', repository); },
        'commit.TRUST_OWNERSHIP': (_, { call }) => { call('trustOwnership'); },
        'commit.RESOLVE_CONFLICT': ({ path, strategy }, { call }) => { call('resolveConflict', { path, strategy }); },
        'commit.MARK_RESOLVED': ({ path }, { call }) => { call('markResolved', path); },
        'commit.RESOLVE_ALL_CONFLICTS': ({ strategy }, { call }) => { call('resolveAllConflicts', strategy); },
        'commit.PUSH_BRANCH': (_, { tell, child }) => {
          tell(child('remotes'), { type: 'PUSH_BRANCH' });
        },
        'commit.STOP_PUSH': (_, { tell, child }) => {
          tell(child('remotes'), { type: 'STOP_PUSH' });
        },
        'commit.DISMISS_ERROR': () => ({ data: { gitError: null, statusFailed: false } }),
        CHILD_ERROR: ({ message }) => ({ data: { gitError: message } }),
        CHILD_UNDOABLE: ({ undoable }, { tell, child }) => {
          tell(child('recovery'), { type: 'SET_UNDOABLE', undoable });
        },
        REQUEST_STATUS_REFRESH: (_, { data }) => ({ data: { statusRev: data.statusRev + 1 } }),
        WORKTREE_SWITCHED: ({ path }, { report }) => {
          report({ type: 'SELECT_REPOSITORY_PATH', path });
        },
      },
    },
  },
});

// ── Backend `statusRefresh` + `writeDebounce` child (`code/be/commit`) ────────────────────────────

export interface FakeGitRepoHandle {
  readonly id: string;
  refreshSnapshot(mode: 'everything' | 'noted', options: { refreshIndex: boolean }): Promise<RepositoryChange>;
  whenFetchDue(cb: (() => void) | undefined): void;
}

const NOTHING_CHANGED: RepositoryChange = {
  status: false,
  diffs: false,
  history: false,
  stashes: false,
  refs: false,
  worktrees: false,
};

const changedAnything = (c: RepositoryChange): boolean =>
  c.status || c.diffs || c.history || c.stashes || c.refs || c.worktrees;

type RefreshRequest = {
  repoId: string | null;
  written: boolean;
  everything: boolean;
  refreshIndex: boolean;
};

const mergeRequest = (one: RefreshRequest, other: RefreshRequest | null): RefreshRequest =>
  other?.repoId !== one.repoId
    ? one
    : {
        repoId: one.repoId,
        written: one.written || other.written,
        everything: one.everything || other.everything,
        refreshIndex: one.refreshIndex || other.refreshIndex,
      };

export function createWriteDebounceState(hooks?: { onTimerStart?: () => void; onTimerEnd?: () => void }) {
  return standaloneState<
    {
      reports: { type: 'WRITE_DUE'; repoId: string | null };
      states: {
        idle: {};
        waiting: { data: { repoId: string | null } };
      };
    },
    { type: 'REFRESH'; repoId: string | null }
  >()({
    initial: 'idle',
    states: {
      idle: {
        on: {
          REFRESH: ({ repoId }) => ({ at: 'waiting', data: { repoId } }),
        },
      },
      waiting: {
        data: { repoId: given },
        run: async ({ data, sleep, report, onExit }) => {
          hooks?.onTimerStart?.();
          let ended = false;
          const markEnd = () => {
            if (!ended) {
              ended = true;
              hooks?.onTimerEnd?.();
            }
          };
          onExit(markEnd);
          await sleep(150);
          markEnd();
          report({ type: 'WRITE_DUE', repoId: data.repoId });
          return { at: 'idle' };
        },
        failed: () => ({ at: 'idle' }),
        on: {
          // Self-target re-entry exits `waiting` (cancelling the old 150ms sleep) and starts a fresh 150ms sleep
          REFRESH: ({ repoId }) => ({ at: 'waiting', data: { repoId } }),
        },
      },
    },
  });
}

export function createStatusRefreshState(options: {
  repositoryOf: (repoId: string | null) => FakeGitRepoHandle | null;
  onAnnounce: (changed: RepositoryChange) => void;
  onTimerStart?: () => void;
  onTimerEnd?: () => void;
}) {
  const writeDebounce = createWriteDebounceState({
    onTimerStart: options.onTimerStart,
    onTimerEnd: options.onTimerEnd,
  });

  return standaloneState<
    {
      data: {
        next: RefreshRequest | null;
        unasked: boolean;
        owed: RefreshRequest | null;
      };
      internal: { type: 'CHECK_FINISHED'; changed: RepositoryChange | null };
      starts: { debounce: typeof writeDebounce };
      states: {
        idle: {};
        checking: { data: { current: RefreshRequest } };
      };
    },
    | { type: 'REFRESH'; repoId: string | null }
    | { type: 'CHECK'; repoId: string | null; everything: boolean; refreshIndex: boolean; byWindow: boolean }
    | { type: 'ASKED'; repoId: string | null }
    | { type: 'WRITE_DUE'; repoId: string | null; from?: string }
  >()({
    data: {
      next: null,
      unasked: false,
      owed: null,
    },
    initial: 'idle',
    starts: () => ({ debounce: writeDebounce }),
    on: {
      REFRESH: ({ repoId }, { tell, child }) => {
        tell(child('debounce'), { type: 'REFRESH', repoId });
      },
    },
    states: {
      idle: {
        on: {
          ASKED: ({ repoId }, { data }) => {
            const waiting = data.owed;
            if (waiting && waiting.repoId === repoId) {
              return { at: 'checking', data: { current: waiting, unasked: false, owed: null } };
            }
            return { data: { unasked: false, owed: null } };
          },
          CHECK: (ev, { data }) => {
            const asked: RefreshRequest = {
              repoId: ev.repoId,
              written: false,
              everything: ev.everything,
              refreshIndex: ev.refreshIndex,
            };
            if (data.unasked && !ev.byWindow) {
              return { data: { owed: { ...mergeRequest(asked, data.owed), refreshIndex: false } } };
            }
            return { at: 'checking', data: { current: asked } };
          },
          WRITE_DUE: ({ repoId }) => ({
            at: 'checking',
            data: { current: { repoId, written: true, everything: true, refreshIndex: false } },
          }),
        },
      },
      checking: {
        data: { current: given },
        run: async ({ data, send }) => {
          const req = data.current;
          const repo = options.repositoryOf(req.repoId);
          const found = repo
            ? await repo.refreshSnapshot(req.everything ? 'everything' : 'noted', { refreshIndex: req.refreshIndex })
            : NOTHING_CHANGED;
          const changed = req.written ? { ...found, status: true } : found;
          send({ type: 'CHECK_FINISHED', changed: changedAnything(changed) ? changed : null });
        },
        failed: () => ({ at: 'idle', data: { next: null } }),
        on: {
          ASKED: ({ repoId }, { data }) => {
            const waiting = data.owed;
            if (waiting && waiting.repoId === repoId) {
              return { data: { unasked: false, owed: null, next: mergeRequest(waiting, data.next) } };
            }
            return { data: { unasked: false, owed: null } };
          },
          CHECK: (ev, { data }) => {
            const asked: RefreshRequest = {
              repoId: ev.repoId,
              written: false,
              everything: ev.everything,
              refreshIndex: ev.refreshIndex,
            };
            if (data.unasked && !ev.byWindow) {
              return { data: { owed: { ...mergeRequest(asked, data.owed), refreshIndex: false } } };
            }
            return { data: { next: mergeRequest(asked, data.next) } };
          },
          WRITE_DUE: ({ repoId }, { data }) => ({
            data: {
              next: mergeRequest(
                { repoId, written: true, everything: true, refreshIndex: false },
                data.next,
              ),
            },
          }),
        },
        internal: {
          CHECK_FINISHED: ({ changed }, { data }) => {
            if (changed) {
              options.onAnnounce(changed);
            }
            const nextUnasked = changed?.status ? true : data.unasked;
            if (data.next) {
              return {
                at: 'checking',
                data: { current: data.next, next: null, unasked: nextUnasked },
              };
            }
            return { at: 'idle', data: { unasked: nextUnasked } };
          },
        },
      },
    },
  });
}

export function createCommitCoordinatorState(options: {
  repositoryOf: (repoId: string | null) => FakeGitRepoHandle | null;
  onAnnounce: (changed: RepositoryChange) => void;
  onFetchDue?: (repoId: string) => void;
  onTimerStart?: () => void;
  onTimerEnd?: () => void;
}) {
  const statusRefresh = createStatusRefreshState(options);

  return state<
    {
      data: { repoId: string | null };
      starts: { statusRefresh: typeof statusRefresh };
      states: {
        detached: {};
        attached: { data: { activeRepoId: string } };
      };
    },
    | { type: 'UPDATE_BASE_DIRECTORY'; repoId: string | null }
    | { type: 'GIT_STATUS_CHANGED' }
    | { type: 'REPOSITORY_MAY_HAVE_CHANGED'; reconcile?: boolean; byWindow?: boolean }
    | { type: 'STATUS_ASKED' }
  >()({
    data: { repoId: null },
    initial: 'detached',
    starts: () => ({ statusRefresh }),
    on: {
      UPDATE_BASE_DIRECTORY: ({ repoId }) =>
        repoId === null
          ? { at: 'detached', data: { repoId: null } }
          : { at: 'attached', data: { repoId, activeRepoId: repoId } },
      GIT_STATUS_CHANGED: (_, { data, tell, child }) => {
        tell(child('statusRefresh'), { type: 'REFRESH', repoId: data.repoId });
      },
      REPOSITORY_MAY_HAVE_CHANGED: ({ reconcile = false, byWindow = false }, { data, tell, child }) => {
        if (!data.repoId) return;
        tell(child('statusRefresh'), {
          type: 'CHECK',
          repoId: data.repoId,
          everything: reconcile,
          refreshIndex: reconcile && !byWindow,
          byWindow,
        });
      },
      STATUS_ASKED: (_, { data, tell, child }) => {
        tell(child('statusRefresh'), { type: 'ASKED', repoId: data.repoId });
      },
    },
    states: {
      detached: {},
      attached: {
        data: { activeRepoId: given },
        run: ({ data, onExit }) => {
          const repo = options.repositoryOf(data.activeRepoId);
          if (!repo) return;
          repo.whenFetchDue(() => {
            options.onFetchDue?.(data.activeRepoId);
          });
          onExit(() => {
            repo.whenFetchDue(undefined);
          });
        },
      },
    },
  });
}
