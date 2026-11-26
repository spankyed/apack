import type { Read } from '@apackdev/state';
import type { GitHubApiFailure, PRListState } from '#features/code/be/services/github-api.ts';
import type { PRDetails, PRFileDiffWhere } from '#features/code/be/contract.ts';
import type { GitStatusFile, GitDiff } from '../commit/state.ts';
import type { OpenFile, PanelType } from '../../contract.ts';
import type { GhPullRequest, GhPRComment, GhReviewThread, PRBranchCheckout } from '#generated/types.ts';
import { state, type PackNet } from '#generated/state.ts';
import { freshKey, untypedOpenSurface } from '@apackdev/sdk/fe';
import { resolveName } from '@apackdev/sdk/ids';
import { getCommentDatabaseId } from './comment-id.ts';

const HOST_SETTINGS = resolveName('settings', 'host');

export type { GhPullRequest, GhPRComment };

type CodeAsks = PackNet['systems']['code']['asks'];

let placeholderIdCounter = -1;

/**
 * What a diff was asked for, as a key: GitHub's own `base...head` compare spelling, with the head absent
 * for a branch that has no PR.
 */
export const refKey = (base: string, head?: string): string => `${base}...${head ?? ''}`;

/** The same, for one file within that comparison: what a file's diff is asked under */
export const fileKey = (base: string, head: string | undefined, path: string): string =>
  `${refKey(base, head)}#${path}`;

/** A change to the discussion, shown before GitHub has answered it */
type CommentChange =
  | { change: 'create'; placeholder: GhPRComment }
  | { change: 'edit'; commentId: number; body: string }
  | { change: 'delete'; commentId: number };

/** A change to the review threads, shown before GitHub has answered it */
type ThreadChange =
  | { change: 'reply'; commentId: number; placeholder: GhReviewThread['comments'][number] }
  | { change: 'resolve'; threadId: string; resolved: boolean }
  | { change: 'edit'; commentId: number; body: string }
  | { change: 'delete'; commentId: number };

/**
 * A write the panel sent and GitHub has not answered, recorded under the key its ask is made under.
 */
export type PullRequestWrite =
  | { write: 'create-pr' }
  | { write: 'merge'; number: number }
  | { write: 'close'; number: number }
  | { write: 'toggle-draft'; number: number }
  | { write: 'delete-branch' }
  | { write: 'checkout'; number: number }
  | { write: 'update-pr'; number: number }
  | { write: 'create-comment'; number: number; comment: CommentChange }
  | { write: 'edit-comment'; number: number; comment: CommentChange }
  | { write: 'delete-comment'; number: number; comment: CommentChange }
  | { write: 'reply'; number: number; thread: ThreadChange }
  | { write: 'resolve-thread'; number: number; thread: ThreadChange }
  | { write: 'edit-review-comment'; number: number; thread: ThreadChange }
  | { write: 'delete-review-comment'; number: number; thread: ThreadChange };

/**
 * How a write that keeps something the user typed was answered — the one a form waits on before it lets
 * go of the text.
 */
export interface WriteAnswer {
  write: 'update-pr' | 'create-comment' | 'edit-comment' | 'reply' | 'edit-review-comment';
  target: number;
  ok: boolean;
}

const writeAnswer = (write: Read<PullRequestWrite>, ok: boolean): WriteAnswer | null => {
  switch (write.write) {
    case 'update-pr':
      return { write: 'update-pr', target: write.number, ok };
    case 'create-comment':
      return { write: 'create-comment', target: write.number, ok };
    case 'edit-comment':
      return write.comment.change === 'edit' ? { write: 'edit-comment', target: write.comment.commentId, ok } : null;
    case 'reply':
      return write.thread.change === 'reply' ? { write: 'reply', target: write.thread.commentId, ok } : null;
    case 'edit-review-comment':
      return write.thread.change === 'edit' ? { write: 'edit-review-comment', target: write.thread.commentId, ok } : null;
    default:
      return null;
  }
};

const applyComment = (comments: readonly Read<GhPRComment>[], change: Read<CommentChange>): GhPRComment[] => {
  switch (change.change) {
    case 'create':
      return [...(comments as GhPRComment[]), change.placeholder as GhPRComment];
    case 'edit':
      return (comments as GhPRComment[]).map((c) =>
        getCommentDatabaseId(c) === change.commentId ? { ...c, body: change.body, rawBody: change.body } : c,
      );
    case 'delete':
      return (comments as GhPRComment[]).filter((c) => getCommentDatabaseId(c) !== change.commentId);
  }
};

const applyThread = (threads: readonly Read<GhReviewThread>[], change: Read<ThreadChange>): GhReviewThread[] => {
  switch (change.change) {
    case 'reply':
      return (threads as GhReviewThread[]).map((t) =>
        t.comments.some((c) => c.databaseId === change.commentId)
          ? { ...t, comments: [...t.comments, change.placeholder as GhReviewThread['comments'][number]] }
          : t,
      );
    case 'resolve':
      return (threads as GhReviewThread[]).map((t) =>
        t.id === change.threadId ? { ...t, isResolved: change.resolved } : t,
      );
    case 'edit':
      return (threads as GhReviewThread[]).map((t) => ({
        ...t,
        comments: t.comments.map((c) => (c.databaseId === change.commentId ? { ...c, body: change.body } : c)),
      }));
    case 'delete':
      return (threads as GhReviewThread[]).map((t) => ({
        ...t,
        comments: t.comments.filter((c) => c.databaseId !== change.commentId),
      }));
  }
};

const commentChangeOf = (write: Read<PullRequestWrite>): Read<CommentChange> | undefined =>
  'comment' in write ? write.comment : undefined;
const threadChangeOf = (write: Read<PullRequestWrite>): Read<ThreadChange> | undefined =>
  'thread' in write ? write.thread : undefined;

const shown = (
  confirmedComments: readonly Read<GhPRComment>[],
  confirmedThreads: readonly Read<GhReviewThread>[],
  writes: Readonly<Record<string, Read<PullRequestWrite>>>,
) => {
  let prComments = confirmedComments as GhPRComment[];
  let reviewThreads = confirmedThreads as GhReviewThread[];
  for (const write of Object.values(writes)) {
    const comment = commentChangeOf(write);
    if (comment) prComments = applyComment(prComments, comment);
    const thread = threadChangeOf(write);
    if (thread) reviewThreads = applyThread(reviewThreads, thread);
  }
  return { prComments, reviewThreads };
};

const busy = (writes: Readonly<Record<string, Read<PullRequestWrite>>>) => {
  const all = Object.values(writes);
  const any = (kind: PullRequestWrite['write']) => all.some((w) => w.write === kind);
  return {
    isCreating: any('create-pr'),
    isMerging: any('merge'),
    isClosing: any('close'),
    isTogglingDraft: any('toggle-draft'),
    isDeletingBranch: any('delete-branch'),
    isCheckingOut: any('checkout'),
    isUpdatingPR: any('update-pr'),
    inflightMutations: all.filter((w) => commentChangeOf(w) || threadChangeOf(w)).length,
  };
};

const withWrites = (
  data: Read<CodePullRequestData>,
  writes: Record<string, PullRequestWrite>,
  confirmed?: { comments?: readonly Read<GhPRComment>[]; threads?: readonly Read<GhReviewThread>[] },
) => {
  const confirmedComments = (confirmed?.comments ?? data.confirmedComments) as GhPRComment[];
  const confirmedThreads = (confirmed?.threads ?? data.confirmedThreads) as GhReviewThread[];
  return {
    writes,
    confirmedComments,
    confirmedThreads,
    ...shown(confirmedComments, confirmedThreads, writes),
    ...busy(writes),
  };
};

const selecting = (data: Read<CodePullRequestData>, next: Read<GhPullRequest> | null): Partial<CodePullRequestData> => {
  if (next?.number === data.selectedPR?.number) return { selectedPR: next as GhPullRequest | null };
  const writes = Object.fromEntries(
    Object.entries(data.writes).filter(([, w]) => !commentChangeOf(w) && !threadChangeOf(w)),
  ) as Record<string, PullRequestWrite>;
  return {
    selectedPR: next as GhPullRequest | null,
    ...withWrites(data, writes, { comments: [], threads: [] }),
    commentsFor: null,
    detailRefreshes: {},
    missingFileDiff: null,
  };
};

/** The pull request list the dropdown shows */
export interface PRList {
  state: PRListState;
  query: string;
  prs: GhPullRequest[];
  next: string | null;
  read: boolean;
}

const listStart = (): PRList => ({ state: 'open', query: '', prs: [], next: null, read: false });

const joined = (prs: readonly Read<GhPullRequest>[], more: readonly Read<GhPullRequest>[]): GhPullRequest[] => {
  const seen = new Set(prs.map((pr) => pr.number));
  return [...(prs as GhPullRequest[]), ...(more as GhPullRequest[]).filter((pr) => !seen.has(pr.number))];
};

export type GitHubAccess = 'ok' | GitHubApiFailure;

const ACCESS_FAILURES: readonly GitHubApiFailure[] = ['signed-out', 'not-github', 'missing-scope', 'sso'];

export const branchDeletable = (pr: Read<GhPullRequest> | null): boolean =>
  !!pr && pr.state !== 'OPEN' && pr.headInRemote === true && (pr.openFromSameHead ?? []).length === 0;

export interface CodePullRequestData {
  baseDirectory: string;
  isPanelShown: boolean;
  diffsByRef: Record<string, GitStatusFile[]>;
  prBaseBranch: string;
  prError: string | null;
  missingFileDiff: { path: string; baseBranch: string; headBranch?: string; prNumber?: number } | null;
  isPrLoading: boolean;
  selectedPrFile: GitStatusFile | null;
  prList: PRList;
  lastCheckout: { number: number; branch: string; checkout: PRBranchCheckout } | null;
  selectedPR: GhPullRequest | null;
  branchPR: GhPullRequest | null;
  prComments: GhPRComment[];
  reviewThreads: GhReviewThread[];
  confirmedComments: GhPRComment[];
  confirmedThreads: GhReviewThread[];
  commentsFor: number | null;
  commentTab: 'discussion' | 'reviews';
  viewMode: 'files' | 'pr';
  githubAccess: GitHubAccess | null;
  githubAccessMessage: string | null;
  isCheckingBranchPR: boolean;
  branchPRCheckFailed: boolean;
  prCheckCompleted: boolean;
  createTitle: string;
  createBody: string;
  createBaseBranch: string;
  createDraft: boolean;
  isCreating: boolean;
  isMerging: boolean;
  isClosing: boolean;
  isTogglingDraft: boolean;
  isDeletingBranch: boolean;
  isCheckingOut: boolean;
  isUpdatingPR: boolean;
  inflightMutations: number;
  writes: Record<string, PullRequestWrite>;
  lastWriteAnswer: WriteAnswer | null;
  diffStale: boolean;
  isManualPRSelection: boolean;
  detailRefreshes: Record<string, number>;
  latestPrDetailsFetchedAt: Record<number, number>;
}

const folderStart = (): Omit<CodePullRequestData, 'commentTab' | 'baseDirectory' | 'isPanelShown'> => ({
  diffsByRef: {},
  prBaseBranch: '',
  prError: null,
  missingFileDiff: null,
  isPrLoading: false,
  selectedPrFile: null,
  prList: listStart(),
  lastCheckout: null,
  selectedPR: null,
  branchPR: null,
  prComments: [],
  reviewThreads: [],
  confirmedComments: [],
  confirmedThreads: [],
  commentsFor: null,
  viewMode: 'files',
  githubAccess: null,
  githubAccessMessage: null,
  isCheckingBranchPR: false,
  branchPRCheckFailed: false,
  prCheckCompleted: false,
  createTitle: '',
  createBody: '',
  createBaseBranch: '',
  createDraft: false,
  ...busy({}),
  writes: {},
  lastWriteAnswer: null,
  diffStale: false,
  isManualPRSelection: false,
  detailRefreshes: {},
  latestPrDetailsFetchedAt: {},
});

export type CodePullRequestReport =
  | { type: 'PR_OPEN_DIFF_TAB'; tab: OpenFile }
  | { type: 'PR_OPEN_FILE'; path: string }
  | { type: 'PR_SELECT_PANEL'; panel: PanelType };

export type CodePullRequestEvent =
  | { type: 'pr.REFRESH_STATUS' }
  | { type: 'pr.SELECT_FILE'; file: GitStatusFile }
  | { type: 'pr.VIEW_DIFF'; path: string }
  | { type: 'pr.FETCH_MISSING_DIFF' }
  | { type: 'pr.OPEN_FILE'; file: GitStatusFile }
  | { type: 'pr.GIT_STATUS_REFRESHED'; data: { timestamp: Date } }
  | { type: 'CODE_STARTED'; baseDirectory?: string }
  | { type: 'SYNC_BASE_DIRECTORY'; baseDirectory: string }
  | { type: 'SYNC_PANEL_SHOWN'; isPanelShown: boolean }
  | { type: 'pr.CHECK_GITHUB_ACCESS' }
  | { type: 'pr.NAVIGATE_TO_HELP' }
  | { type: 'pr.SELECT_PR_BY_NUMBER'; number: number }
  | { type: 'pr.SET_VIEW_MODE'; mode: 'files' | 'pr' }
  | { type: 'pr.NEW_PR' }
  | { type: 'pr.UPDATE_CREATE_FIELD'; field: string; value: any }
  | { type: 'pr.SUBMIT_CREATE' }
  | { type: 'pr.SUBMIT_CREATE_DRAFT' }
  | { type: 'pr.MERGE'; method?: 'merge' | 'squash' | 'rebase' }
  | { type: 'pr.CLOSE' }
  | { type: 'pr.TOGGLE_DRAFT' }
  | { type: 'pr.DELETE_BRANCH' }
  | { type: 'pr.CHECKOUT_BASE' }
  | { type: 'pr.CHECKOUT' }
  | { type: 'pr.LIST_SHOWN' }
  | { type: 'pr.SET_LIST_STATE'; state: PRListState }
  | { type: 'pr.SET_LIST_QUERY'; query: string }
  | { type: 'pr.LOAD_MORE_PRS' }
  | { type: 'pr.UPDATE_PR'; number: number; title?: string; body?: string; base?: string }
  | { type: 'pr.CREATE_COMMENT'; number: number; body: string }
  | { type: 'pr.EDIT_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_COMMENT'; commentId: number }
  | { type: 'pr.REPLY_TO_THREAD'; prNumber: number; commentId: number; body: string }
  | { type: 'pr.RESOLVE_THREAD'; threadId: string }
  | { type: 'pr.UNRESOLVE_THREAD'; threadId: string }
  | { type: 'pr.EDIT_REVIEW_COMMENT'; commentId: number; body: string }
  | { type: 'pr.DELETE_REVIEW_COMMENT'; commentId: number }
  | { type: 'pr.SET_COMMENT_TAB'; tab: 'discussion' | 'reviews' }
  | { type: 'pr.REFRESH_PR'; number: number }
  | { type: 'pr.BACK_TO_BRANCH' }
  | { type: 'pr.CLEAR_ERROR' };

type KeyedCall<A> = { key: string; args: A };

type CodePullRequestShape = {
  data: CodePullRequestData;
  reports: CodePullRequestReport;
  calls: {
    details: { readonly one: CodeAsks['pr.SELECT_PR']['args'] };
    comments: { readonly one: CodeAsks['pr.GET_COMMENTS']['args'] };
    threads: { readonly one: CodeAsks['pr.GET_REVIEW_THREADS']['args'] };
    branchPR: 'one';
    smartBase: 'one';
    access: 'one';
    autofill: 'one';
    list: { readonly one: CodeAsks['pr.LIST_PRS']['args'] };
    listMore: { readonly one: CodeAsks['pr.LIST_PRS']['args'] };
    checkoutBase: { readonly one: CodeAsks['commit.CHECKOUT_BRANCH']['args'] };
    diff: { readonly each: CodeAsks['pr.GET_BRANCH_DIFF']['args'] };
    fileDiff: { readonly each: CodeAsks['pr.GET_BRANCH_FILE_DIFF']['args'] };
    createPR: { readonly many: KeyedCall<CodeAsks['pr.CREATE_PR']['args']> };
    merge: { readonly many: KeyedCall<CodeAsks['pr.MERGE_PR']['args']> };
    close: { readonly many: KeyedCall<CodeAsks['pr.CLOSE_PR']['args']> };
    toggleDraft: { readonly many: KeyedCall<CodeAsks['pr.TOGGLE_DRAFT']['args']> };
    deleteBranch: { readonly many: KeyedCall<CodeAsks['pr.DELETE_BRANCH']['args']> };
    checkout: { readonly many: KeyedCall<CodeAsks['pr.CHECKOUT_PR']['args']> };
    updatePR: { readonly many: KeyedCall<CodeAsks['pr.UPDATE_PR']['args']> };
    createComment: { readonly many: KeyedCall<CodeAsks['pr.CREATE_COMMENT']['args']> };
    editComment: { readonly many: KeyedCall<CodeAsks['pr.EDIT_COMMENT']['args']> };
    deleteComment: { readonly many: KeyedCall<CodeAsks['pr.DELETE_COMMENT']['args']> };
    replyToThread: { readonly many: KeyedCall<CodeAsks['pr.REPLY_TO_THREAD']['args']> };
    resolveThread: { readonly many: KeyedCall<CodeAsks['pr.RESOLVE_THREAD']['args']> };
    unresolveThread: { readonly many: KeyedCall<CodeAsks['pr.UNRESOLVE_THREAD']['args']> };
    editReviewComment: { readonly many: KeyedCall<CodeAsks['pr.EDIT_REVIEW_COMMENT']['args']> };
    deleteReviewComment: { readonly many: KeyedCall<CodeAsks['pr.DELETE_REVIEW_COMMENT']['args']> };
  };
};

const settled = <T>(asks: Readonly<Record<string, T>>, key: string): { recorded: T | undefined; pending: Record<string, T> } => {
  const { [key]: recorded, ...pending } = asks;
  return { recorded, pending };
};

const failureShown = (failure: { kind: string; message: string; reason?: GitHubApiFailure }): Partial<CodePullRequestData> => {
  const reason = failure.kind === 'github' ? failure.reason : undefined;
  return reason && ACCESS_FAILURES.includes(reason)
    ? { githubAccess: reason, githubAccessMessage: failure.message }
    : { prError: failure.message };
};

const refreshes = (data: Read<CodePullRequestData>, key: string, details: PRDetails | undefined): details is PRDetails =>
  !!details && data.detailRefreshes[key] === details.pr.number && data.selectedPR?.number === details.pr.number;

const recordWritePatch = (
  data: Read<CodePullRequestData>,
  key: string,
  write: PullRequestWrite,
  refreshesNumber?: number,
): Partial<CodePullRequestData> => ({
  prError: null,
  ...withWrites(data, { ...(data.writes as Record<string, PullRequestWrite>), [key]: write }),
  ...(refreshesNumber !== undefined ? { detailRefreshes: { ...data.detailRefreshes, [key]: refreshesNumber } } : {}),
});

function cancelAllFileDiffs(
  pending: Readonly<Record<string, true>>,
  cancel: (name: 'fileDiff', key: string) => void,
): void {
  for (const key of Object.keys(pending)) cancel('fileDiff', key);
}

function leaveDiscussionCalls(
  data: Read<CodePullRequestData>,
  next: Read<GhPullRequest> | null,
  pendingFileDiffs: Readonly<Record<string, true>>,
  cancel: {
    (name: 'comments' | 'threads'): void;
    (name: 'fileDiff', key: string): void;
  },
): void {
  if (next?.number === data.selectedPR?.number) return;
  cancel('comments');
  cancel('threads');
  cancelAllFileDiffs(pendingFileDiffs, cancel);
}

function takeDetailsPatch(
  data: Read<CodePullRequestData>,
  details: PRDetails,
  pendingFileDiffs: Readonly<Record<string, true>>,
  cancel: {
    (name: 'comments' | 'threads'): void;
    (name: 'diff' | 'fileDiff', key: string): void;
  },
  call: {
    (name: 'threads', input: { number: number }): void;
    (name: 'diff', key: string, input: CodeAsks['pr.GET_BRANCH_DIFF']['args']): void;
  },
): Partial<CodePullRequestData> | undefined {
  const prNumber = details.pr.number;
  if (details.fetchedAt < (data.latestPrDetailsFetchedAt[prNumber] ?? 0)) return undefined;
  leaveDiscussionCalls(data, details.pr, pendingFileDiffs, cancel);
  const left = selecting(data, details.pr);
  const held = { ...data, ...left } as Read<CodePullRequestData>;
  const diffKey = refKey(details.pr.baseRefName, details.pr.headRefName);
  cancel('diff', diffKey);
  call('diff', diffKey, {
    baseBranch: details.pr.baseRefName,
    ...(details.pr.headRefName ? { headBranch: details.pr.headRefName } : {}),
    prNumber,
  });
  cancel('threads');
  call('threads', { number: prNumber });
  return {
    ...left,
    ...withWrites(held, held.writes as Record<string, PullRequestWrite>, { comments: details.comments }),
    commentsFor: prNumber,
    latestPrDetailsFetchedAt: { ...data.latestPrDetailsFetchedAt, [prNumber]: details.fetchedAt },
    prBaseBranch: details.pr.baseRefName,
  };
}

function endWritePatch(
  data: Read<CodePullRequestData>,
  key: string,
  outcome: { ok: true } | { ok: false; failure: { kind: string; message: string; reason?: GitHubApiFailure } },
  cancel: (name: 'comments' | 'threads') => void,
  call: (name: 'comments' | 'threads', input: { number: number }) => void,
): { recorded: Read<PullRequestWrite> | undefined; patch: Partial<CodePullRequestData> } {
  const { recorded, pending: remainingWrites } = settled(data.writes, key);
  const patch: Partial<CodePullRequestData> = {
    detailRefreshes: settled(data.detailRefreshes, key).pending,
  };
  if (!outcome.ok) Object.assign(patch, failureShown(outcome.failure));
  if (recorded === undefined) return { recorded: undefined, patch };

  const answer = writeAnswer(recorded, outcome.ok);
  const comment = outcome.ok ? commentChangeOf(recorded) : undefined;
  const thread = outcome.ok ? threadChangeOf(recorded) : undefined;
  Object.assign(
    patch,
    withWrites(data, remainingWrites as Record<string, PullRequestWrite>, {
      ...(comment ? { comments: applyComment(data.confirmedComments, comment) } : {}),
      ...(thread ? { threads: applyThread(data.confirmedThreads, thread) } : {}),
    }),
    answer ? { lastWriteAnswer: answer } : {},
  );
  const number = data.selectedPR?.number;
  if (comment && number !== undefined) {
    cancel('comments');
    call('comments', { number });
  }
  if (thread && number !== undefined) {
    cancel('threads');
    call('threads', { number });
  }
  return { recorded, patch };
}

export const pullRequestState = state<CodePullRequestShape, CodePullRequestEvent>()({
  data: {
    baseDirectory: '',
    isPanelShown: false,
    ...folderStart(),
    commentTab: 'discussion',
  },
  calls: ({ one, each, many }) => ({
      details: one('code', 'pr.SELECT_PR', {
        done: (outcome, { data, snapshot, cancel, call }) => {
          if (!outcome.ok) return { data: { ...failureShown(outcome.failure), isPrLoading: false } };
          const patch = takeDetailsPatch(data, outcome.value, snapshot.pending.fileDiff, cancel, call);
          return patch ? { data: patch } : undefined;
        },
      }),
      comments: one('code', 'pr.GET_COMMENTS', {
        done: (outcome, { data }) =>
          outcome.ok
            ? {
                data: {
                  ...withWrites(data, data.writes as Record<string, PullRequestWrite>, {
                    comments: outcome.value.comments,
                  }),
                  commentsFor: outcome.value.number,
                },
              }
            : undefined,
      }),
      threads: one('code', 'pr.GET_REVIEW_THREADS', {
        done: (outcome, { data }) =>
          outcome.ok
            ? {
                data: withWrites(data, data.writes as Record<string, PullRequestWrite>, {
                  threads: outcome.value.threads,
                }),
              }
            : { data: failureShown(outcome.failure) },
      }),
      branchPR: one('code', 'pr.CHECK_BRANCH_PR', {
        done: (outcome, { data, snapshot, cancel, call }) => {
          if (!outcome.ok) {
            return {
              data: {
                ...failureShown(outcome.failure),
                isCheckingBranchPR: false,
                branchPRCheckFailed: !data.selectedPR,
                isPrLoading: false,
              },
            };
          }
          const incoming = outcome.value.pr;
          const unchanged =
            incoming?.number === data.selectedPR?.number && incoming?.updatedAt === data.selectedPR?.updatedAt;
          const kept = data.isManualPRSelection || unchanged;
          if (!kept) leaveDiscussionCalls(data, incoming, snapshot.pending.fileDiff, cancel);

          let prBasePatch: Partial<CodePullRequestData> = {};
          if (!data.isManualPRSelection) {
            if (incoming) {
              const key = refKey(incoming.baseRefName, incoming.headRefName);
              const needsDiff = !data.diffsByRef[key] || data.diffStale;
              if (needsDiff) {
                prBasePatch = { prBaseBranch: incoming.baseRefName };
                cancel('diff', key);
                call('diff', key, {
                  baseBranch: incoming.baseRefName,
                  ...(incoming.headRefName ? { headBranch: incoming.headRefName } : {}),
                  prNumber: incoming.number,
                });
              }
            } else {
              cancel('smartBase');
              call('smartBase');
            }
          }

          return {
            data: {
              branchPR: incoming,
              ...(kept ? {} : selecting(data, incoming)),
              ...prBasePatch,
              isCheckingBranchPR: false,
              branchPRCheckFailed: false,
              prCheckCompleted: true,
            },
          };
        },
      }),
      smartBase: one('code', 'pr.GET_SMART_BASE_BRANCH', {
        done: (outcome, { data, cancel, call }) => {
          if (!outcome.ok) return { data: { ...failureShown(outcome.failure), isPrLoading: false } };
          const newBase = outcome.value.branch;
          const key = refKey(newBase);
          if (!data.diffsByRef[key] || data.diffStale) {
            cancel('diff', key);
            call('diff', key, { baseBranch: newBase });
          }
          return { data: { prBaseBranch: newBase } };
        },
      }),
      access: one('code', 'pr.CHECK_GITHUB_ACCESS', {
        done: (outcome) =>
          outcome.ok
            ? { data: { githubAccess: outcome.value.access, githubAccessMessage: outcome.value.message ?? null } }
            : { data: failureShown(outcome.failure) },
      }),
      autofill: one('code', 'pr.GET_PR_AUTOFILL', {
        done: (outcome, { data }) =>
          outcome.ok
            ? {
                data: {
                  createTitle: data.createTitle || outcome.value.title,
                  createBody: data.createBody || outcome.value.body,
                },
              }
            : { data: failureShown(outcome.failure) },
      }),
      list: one('code', 'pr.LIST_PRS', {
        done: (outcome, { data }) => {
          if (!outcome.ok) return { data: failureShown(outcome.failure) };
          return {
            data: {
              prList: { ...data.prList, prs: outcome.value.prs, next: outcome.value.next, read: true },
            },
          };
        },
      }),
      listMore: one('code', 'pr.LIST_PRS', {
        done: (outcome, { data }) => {
          if (!outcome.ok) return { data: failureShown(outcome.failure) };
          return {
            data: {
              prList: {
                ...data.prList,
                prs: joined(data.prList.prs, outcome.value.prs),
                next: outcome.value.next,
                read: true,
              },
            },
          };
        },
      }),
      checkoutBase: one('code', 'commit.CHECKOUT_BRANCH', {
        done: (outcome, { report }) => {
          if (outcome.ok) {
            report({ type: 'PR_SELECT_PANEL', panel: 'commit' });
            return;
          }
          return { data: failureShown(outcome.failure) };
        },
      }),
      diff: each('code', 'pr.GET_BRANCH_DIFF', {
        args: (_key, input) => input,
        done: (outcome, { key, data }) => {
          if (!outcome.ok) return { data: { ...failureShown(outcome.failure), isPrLoading: false } };
          return {
            data: {
              diffsByRef: { ...data.diffsByRef, [key]: outcome.value.files },
              isPrLoading: false,
              diffStale: false,
            },
          };
        },
      }),
      fileDiff: each('code', 'pr.GET_BRANCH_FILE_DIFF', {
        args: (_key, input) => input,
        done: (outcome, { data, report }) => {
          if (!outcome.ok) {
            if (outcome.failure.kind !== 'content-missing') {
              return { data: failureShown(outcome.failure) };
            }
            const { kind: _kind, message: _message, ...where } = outcome.failure;
            return { data: { missingFileDiff: where } };
          }
          const diff: GitDiff = outcome.value;
          const selected = data.selectedPrFile;
          if (selected?.path !== diff.path) return;
          const diffTab: OpenFile = {
            path: `pr-diff:${selected.path}`,
            content: '',
            originalContent: '',
            modified: false,
            isDiff: true,
            isPrDiff: true,
            gitDiff: diff,
            gitFile: selected as GitStatusFile,
          };
          report({ type: 'PR_OPEN_DIFF_TAB', tab: diffTab });
        },
      }),
      createPR: many('code', 'pr.CREATE_PR', {
        args: (input) => input.args,
        done: (outcome, { input, data, snapshot, cancel, call }) => {
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded || !outcome.ok) return { data: patch };
          const { pr } = outcome.value;
          const merged = { ...data, ...patch } as Read<CodePullRequestData>;
          leaveDiscussionCalls(merged, pr, snapshot.pending.fileDiff, cancel);
          cancel('branchPR');
          call('branchPR');
          return {
            data: {
              ...patch,
              ...selecting(merged, pr),
              createTitle: '',
              createBody: '',
              createBaseBranch: '',
              createDraft: false,
              isManualPRSelection: false,
            },
          };
        },
      }),
      merge: many('code', 'pr.MERGE_PR', {
        args: (input) => input.args,
        done: (outcome, { input, data, snapshot, cancel, call }) => {
          if (!outcome.ok) {
            const details =
              outcome.failure.kind === 'github' && 'details' in outcome.failure ? outcome.failure.details : undefined;
            const detailsPatch = refreshes(data, input.key, details)
              ? takeDetailsPatch(data, details, snapshot.pending.fileDiff, cancel, call)
              : undefined;
            const afterDetails = detailsPatch ? ({ ...data, ...detailsPatch } as Read<CodePullRequestData>) : data;
            const { patch } = endWritePatch(afterDetails, input.key, outcome, cancel, call);
            return { data: { ...detailsPatch, ...patch } };
          }
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded) return { data: patch };
          const { number } = outcome.value;
          const donePr = (pr: Read<GhPullRequest> | null) =>
            pr?.number === number ? { ...(pr as GhPullRequest), state: 'MERGED' as const } : (pr as GhPullRequest | null);
          cancel('branchPR');
          call('branchPR');
          return {
            data: {
              ...patch,
              selectedPR: donePr(data.selectedPR),
              branchPR: donePr(data.branchPR),
            },
          };
        },
      }),
      close: many('code', 'pr.CLOSE_PR', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => {
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded || !outcome.ok) return { data: patch };
          const { number } = outcome.value;
          const donePr = (pr: Read<GhPullRequest> | null) =>
            pr?.number === number ? { ...(pr as GhPullRequest), state: 'CLOSED' as const } : (pr as GhPullRequest | null);
          cancel('branchPR');
          call('branchPR');
          return {
            data: {
              ...patch,
              selectedPR: donePr(data.selectedPR),
              branchPR: donePr(data.branchPR),
            },
          };
        },
      }),
      toggleDraft: many('code', 'pr.TOGGLE_DRAFT', {
        args: (input) => input.args,
        done: (outcome, { input, data, snapshot, cancel, call }) => {
          const refreshed = outcome.ok && refreshes(data, input.key, outcome.value.details);
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded || !outcome.ok) return { data: patch };
          const { number, isDraft, details } = outcome.value;
          const withDraft: Partial<CodePullRequestData> = {
            ...patch,
            selectedPR:
              data.selectedPR?.number === number
                ? { ...(data.selectedPR as GhPullRequest), isDraft }
                : (data.selectedPR as GhPullRequest | null),
          };
          if (refreshed && details) {
            const afterDraft = { ...data, ...withDraft } as Read<CodePullRequestData>;
            const detailsPatch = takeDetailsPatch(afterDraft, details, snapshot.pending.fileDiff, cancel, call);
            return { data: { ...withDraft, ...detailsPatch } };
          }
          return { data: withDraft };
        },
      }),
      deleteBranch: many('code', 'pr.DELETE_BRANCH', {
        args: (input) => input.args,
        done: (outcome, { input, data, snapshot, cancel, call }) => {
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded || !outcome.ok) return { data: patch };
          const merged = { ...data, ...patch } as Read<CodePullRequestData>;
          leaveDiscussionCalls(merged, null, snapshot.pending.fileDiff, cancel);
          return {
            data: {
              ...patch,
              ...selecting(merged, null),
              branchPR: null,
              isManualPRSelection: false,
            },
          };
        },
      }),
      checkout: many('code', 'pr.CHECKOUT_PR', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => {
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded || !outcome.ok) return { data: patch };
          return { data: { ...patch, lastCheckout: outcome.value } };
        },
      }),
      updatePR: many('code', 'pr.UPDATE_PR', {
        args: (input) => input.args,
        done: (outcome, { input, data, snapshot, cancel, call }) => {
          const refreshed = outcome.ok && refreshes(data, input.key, outcome.value.details);
          const { recorded, patch } = endWritePatch(data, input.key, outcome, cancel, call);
          if (!recorded || !outcome.ok) return { data: patch };
          const { number, title, body, base, details } = outcome.value;
          const withUpdated: Partial<CodePullRequestData> = {
            ...patch,
            selectedPR:
              data.selectedPR?.number === number
                ? {
                    ...(data.selectedPR as GhPullRequest),
                    ...(title ? { title } : {}),
                    ...(body !== undefined ? { body, rawBody: body } : {}),
                    ...(base ? { baseRefName: base } : {}),
                  }
                : (data.selectedPR as GhPullRequest | null),
            diffStale: base ? true : data.diffStale,
          };
          if (data.baseDirectory) {
            cancel('branchPR');
            call('branchPR');
          }
          if (refreshed && details) {
            const afterUpdated = { ...data, ...withUpdated } as Read<CodePullRequestData>;
            const detailsPatch = takeDetailsPatch(afterUpdated, details, snapshot.pending.fileDiff, cancel, call);
            return { data: { ...withUpdated, ...detailsPatch } };
          }
          return { data: withUpdated };
        },
      }),
      createComment: many('code', 'pr.CREATE_COMMENT', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      editComment: many('code', 'pr.EDIT_COMMENT', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      deleteComment: many('code', 'pr.DELETE_COMMENT', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      replyToThread: many('code', 'pr.REPLY_TO_THREAD', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      resolveThread: many('code', 'pr.RESOLVE_THREAD', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      unresolveThread: many('code', 'pr.UNRESOLVE_THREAD', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      editReviewComment: many('code', 'pr.EDIT_REVIEW_COMMENT', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
      deleteReviewComment: many('code', 'pr.DELETE_REVIEW_COMMENT', {
        args: (input) => input.args,
        done: (outcome, { input, data, cancel, call }) => ({ data: endWritePatch(data, input.key, outcome, cancel, call).patch }),
      }),
  }),
  on: {
    CODE_STARTED: (event, { data, snapshot, cancel, call }) => {
      cancel('details');
      cancel('comments');
      cancel('threads');
      cancel('branchPR');
      cancel('smartBase');
      cancel('access');
      cancel('autofill');
      cancel('list');
      cancel('listMore');
      cancel('checkoutBase');
      for (const key of Object.keys(snapshot.pending.diff)) cancel('diff', key);
      cancelAllFileDiffs(snapshot.pending.fileDiff, cancel);

      const baseDirectory = event.baseDirectory !== undefined ? event.baseDirectory : data.baseDirectory;
      const reset: Partial<CodePullRequestData> = {
        ...folderStart(),
        baseDirectory,
      };
      if (!baseDirectory) return { data: reset };

      call('access');
      if (data.isPanelShown) {
        call('branchPR');
        return {
          data: {
            ...reset,
            isPrLoading: true,
            isCheckingBranchPR: true,
          },
        };
      }
      return { data: reset };
    },
    SYNC_BASE_DIRECTORY: ({ baseDirectory }) => ({ data: { baseDirectory } }),
    SYNC_PANEL_SHOWN: ({ isPanelShown }) => ({ data: { isPanelShown } }),
    'pr.REFRESH_STATUS': (_event, { data, cancel, call }) => {
      if (!data.baseDirectory) return;
      cancel('branchPR');
      call('branchPR');
      return {
        data: {
          isPrLoading: !data.diffsByRef[refKey(data.prBaseBranch, data.selectedPR?.headRefName)],
          isCheckingBranchPR: !data.prCheckCompleted,
          branchPRCheckFailed: false,
          prError: null,
        },
      };
    },
    'pr.GIT_STATUS_REFRESHED': (_event, { data, cancel, call }) => {
      if (!data.isPanelShown || !data.baseDirectory) {
        return { data: { diffStale: true, prCheckCompleted: false } };
      }
      cancel('branchPR');
      call('branchPR');
      return { data: { diffStale: true, prCheckCompleted: false, isCheckingBranchPR: true } };
    },
    'pr.SELECT_FILE': ({ file }) => ({ data: { selectedPrFile: file, missingFileDiff: null } }),
    'pr.VIEW_DIFF': ({ path }, { data, cancel, call }) => {
      const which: PRFileDiffWhere = {
        path,
        baseBranch: data.prBaseBranch,
        headBranch: data.selectedPR?.headRefName,
        ...(data.selectedPR ? { prNumber: data.selectedPR.number } : {}),
      };
      const key = fileKey(which.baseBranch, which.headBranch, which.path);
      cancel('fileDiff', key);
      call('fileDiff', key, which);
    },
    'pr.FETCH_MISSING_DIFF': (_event, { data, cancel, call }) => {
      const missing = data.missingFileDiff;
      if (!missing) return;
      const key = fileKey(missing.baseBranch, missing.headBranch, missing.path);
      cancel('fileDiff', key);
      call('fileDiff', key, { ...missing, fetchMissing: true });
      return { data: { missingFileDiff: null } };
    },
    'pr.OPEN_FILE': ({ file }, { data, report }) => {
      const baseDirectory = data.baseDirectory;
      const fullPath = file.path.startsWith('/')
        ? file.path
        : baseDirectory.endsWith('/')
          ? baseDirectory + file.path
          : baseDirectory + '/' + file.path;
      report({ type: 'PR_OPEN_FILE', path: fullPath });
    },
    'pr.CHECK_GITHUB_ACCESS': (_event, { cancel, call }) => {
      cancel('access');
      call('access');
    },
    'pr.NAVIGATE_TO_HELP': () => {
      untypedOpenSurface(HOST_SETTINGS, [{ type: 'TAB.SELECT', tab: 'help' }]);
    },
    'pr.SELECT_PR_BY_NUMBER': ({ number }, { cancel, call }) => {
      cancel('details');
      call('details', { number });
      return {
        data: {
          isPrLoading: true,
          viewMode: 'files',
          isManualPRSelection: true,
        },
      };
    },
    'pr.REFRESH_PR': ({ number }, { cancel, call }) => {
      cancel('details');
      call('details', { number });
    },
    'pr.SET_VIEW_MODE': ({ mode }, { data, snapshot, call }) => {
      const pr = data.selectedPR;
      if (mode === 'pr' && pr && data.commentsFor !== pr.number && !snapshot.pending.details) {
        call('details', { number: pr.number });
      }
      return { data: { viewMode: mode, prError: null } };
    },
    'pr.NEW_PR': (_event, { data, snapshot, cancel, call }) => {
      leaveDiscussionCalls(data, null, snapshot.pending.fileDiff, cancel);
      cancel('autofill');
      call('autofill');
      return {
        data: {
          ...selecting(data, null),
          viewMode: 'pr',
          prError: null,
          createTitle: '',
          createBody: '',
          createDraft: false,
          isManualPRSelection: false,
        },
      };
    },
    'pr.UPDATE_CREATE_FIELD': ({ field, value }, { data }) => ({
      data: {
        createTitle: field === 'title' ? value : data.createTitle,
        createBody: field === 'body' ? value : data.createBody,
        createBaseBranch: field === 'baseBranch' ? value : data.createBaseBranch,
        createDraft: field === 'draft' ? value : data.createDraft,
      },
    }),
    'pr.SUBMIT_CREATE': (_event, { data, call }) => {
      const key = freshKey();
      call('createPR', {
        key,
        args: {
          title: data.createTitle,
          body: data.createBody,
          base: data.createBaseBranch || data.prBaseBranch || undefined,
          draft: data.createDraft,
        },
      });
      return { data: recordWritePatch(data, key, { write: 'create-pr' }) };
    },
    'pr.SUBMIT_CREATE_DRAFT': (_event, { data, call }) => {
      const key = freshKey();
      call('createPR', {
        key,
        args: {
          title: data.createTitle,
          body: data.createBody,
          base: data.createBaseBranch || data.prBaseBranch || undefined,
          draft: true,
        },
      });
      return { data: recordWritePatch(data, key, { write: 'create-pr' }) };
    },
    'pr.MERGE': ({ method }, { data, call }) => {
      if (!data.selectedPR) return;
      const { number, headRefOid: sha } = data.selectedPR;
      const key = freshKey();
      call('merge', { key, args: { number, method: method || 'merge', ...(sha ? { sha } : {}) } });
      return { data: recordWritePatch(data, key, { write: 'merge', number }, number) };
    },
    'pr.CLOSE': (_event, { data, call }) => {
      if (!data.selectedPR) return;
      const number = data.selectedPR.number;
      const key = freshKey();
      call('close', { key, args: { number } });
      return { data: recordWritePatch(data, key, { write: 'close', number }) };
    },
    'pr.TOGGLE_DRAFT': (_event, { data, call }) => {
      if (!data.selectedPR) return;
      const { number, isDraft } = data.selectedPR;
      const key = freshKey();
      call('toggleDraft', { key, args: { number, isDraft } });
      return { data: recordWritePatch(data, key, { write: 'toggle-draft', number }, number) };
    },
    'pr.DELETE_BRANCH': (_event, { data, call }) => {
      const pr = data.selectedPR;
      if (!pr || !branchDeletable(pr)) return;
      const key = freshKey();
      call('deleteBranch', { key, args: { number: pr.number } });
      return { data: recordWritePatch(data, key, { write: 'delete-branch' }) };
    },
    'pr.CHECKOUT_BASE': (_event, { data, snapshot, call }) => {
      const branchName = data.selectedPR?.baseRefName;
      if (!branchName || snapshot.pending.checkoutBase) return;
      call('checkoutBase', { branchName, pull: true });
      return { data: { prError: null } };
    },
    'pr.CHECKOUT': (_event, { data, call }) => {
      const pr = data.selectedPR;
      if (!pr || pr.state !== 'OPEN' || data.isCheckingOut) return;
      const key = freshKey();
      call('checkout', { key, args: { number: pr.number } });
      return {
        data: {
          lastCheckout: null,
          ...recordWritePatch(data, key, { write: 'checkout', number: pr.number }),
        },
      };
    },
    'pr.LIST_SHOWN': (_event, { data, cancel, call }) => {
      cancel('listMore');
      cancel('list');
      call('list', {
        state: data.prList.state,
        ...(data.prList.query.trim() ? { query: data.prList.query.trim() } : {}),
      });
    },
    'pr.SET_LIST_STATE': ({ state: nextState }, { data, cancel, call }) => {
      if (nextState === data.prList.state) return;
      cancel('listMore');
      cancel('list');
      call('list', {
        state: nextState,
        ...(data.prList.query.trim() ? { query: data.prList.query.trim() } : {}),
      });
      return {
        data: { prList: { ...data.prList, state: nextState, prs: [], next: null, read: false } },
      };
    },
    'pr.SET_LIST_QUERY': ({ query }, { data, cancel, call }) => {
      if (query.trim() === data.prList.query.trim()) return;
      cancel('listMore');
      cancel('list');
      call('list', {
        state: data.prList.state,
        ...(query.trim() ? { query: query.trim() } : {}),
      });
      return {
        data: { prList: { ...data.prList, query, prs: [], next: null, read: false } },
      };
    },
    'pr.LOAD_MORE_PRS': (_event, { data, snapshot, call }) => {
      if (data.prList.next === null || snapshot.pending.list || snapshot.pending.listMore) return;
      call('listMore', {
        state: data.prList.state,
        ...(data.prList.query.trim() ? { query: data.prList.query.trim() } : {}),
        after: data.prList.next,
      });
    },
    'pr.UPDATE_PR': ({ number, title, body, base }, { data, call }) => {
      const key = freshKey();
      call('updatePR', { key, args: { number, title, body, base } });
      return { data: recordWritePatch(data, key, { write: 'update-pr', number }, number) };
    },
    'pr.CREATE_COMMENT': ({ number, body }, { data, call }) => {
      const pid = placeholderIdCounter--;
      const placeholder: GhPRComment = {
        id: `pending-${pid}`,
        body,
        author: { login: '...' },
        createdAt: new Date().toISOString(),
        url: `pending-${pid}`,
        viewerDidAuthor: true,
      };
      const key = freshKey();
      call('createComment', { key, args: { number, body } });
      return {
        data: recordWritePatch(data, key, { write: 'create-comment', number, comment: { change: 'create', placeholder } }),
      };
    },
    'pr.EDIT_COMMENT': ({ commentId, body }, { data, call }) => {
      const key = freshKey();
      call('editComment', { key, args: { commentId, body } });
      return {
        data: recordWritePatch(data, key, {
          write: 'edit-comment',
          number: data.selectedPR?.number ?? 0,
          comment: { change: 'edit', commentId, body },
        }),
      };
    },
    'pr.DELETE_COMMENT': ({ commentId }, { data, call }) => {
      const key = freshKey();
      call('deleteComment', { key, args: { commentId } });
      return {
        data: recordWritePatch(data, key, {
          write: 'delete-comment',
          number: data.selectedPR?.number ?? 0,
          comment: { change: 'delete', commentId },
        }),
      };
    },
    'pr.REPLY_TO_THREAD': ({ prNumber, commentId, body }, { data, call }) => {
      const pid = placeholderIdCounter--;
      const placeholder = {
        id: `pending-${pid}`,
        databaseId: pid,
        body,
        author: { login: '...' },
        createdAt: new Date().toISOString(),
        viewerDidAuthor: true,
      };
      const key = freshKey();
      call('replyToThread', { key, args: { prNumber, commentId, body } });
      return {
        data: recordWritePatch(data, key, {
          write: 'reply',
          number: prNumber,
          thread: { change: 'reply', commentId, placeholder },
        }),
      };
    },
    'pr.RESOLVE_THREAD': ({ threadId }, { data, call }) => {
      const key = freshKey();
      call('resolveThread', { key, args: { threadId } });
      return {
        data: recordWritePatch(data, key, {
          write: 'resolve-thread',
          number: data.selectedPR?.number ?? 0,
          thread: { change: 'resolve', threadId, resolved: true },
        }),
      };
    },
    'pr.UNRESOLVE_THREAD': ({ threadId }, { data, call }) => {
      const key = freshKey();
      call('unresolveThread', { key, args: { threadId } });
      return {
        data: recordWritePatch(data, key, {
          write: 'resolve-thread',
          number: data.selectedPR?.number ?? 0,
          thread: { change: 'resolve', threadId, resolved: false },
        }),
      };
    },
    'pr.EDIT_REVIEW_COMMENT': ({ commentId, body }, { data, call }) => {
      const key = freshKey();
      call('editReviewComment', { key, args: { commentId, body } });
      return {
        data: recordWritePatch(data, key, {
          write: 'edit-review-comment',
          number: data.selectedPR?.number ?? 0,
          thread: { change: 'edit', commentId, body },
        }),
      };
    },
    'pr.DELETE_REVIEW_COMMENT': ({ commentId }, { data, call }) => {
      const key = freshKey();
      call('deleteReviewComment', { key, args: { commentId } });
      return {
        data: recordWritePatch(data, key, {
          write: 'delete-review-comment',
          number: data.selectedPR?.number ?? 0,
          thread: { change: 'delete', commentId },
        }),
      };
    },
    'pr.SET_COMMENT_TAB': ({ tab }) => ({ data: { commentTab: tab } }),
    'pr.BACK_TO_BRANCH': (_event, { data, snapshot, cancel, call }) => {
      cancel('details');
      cancel('comments');
      cancel('threads');
      if (data.selectedPR) cancelAllFileDiffs(snapshot.pending.fileDiff, cancel);
      cancel('branchPR');
      call('branchPR');
      return {
        data: {
          ...selecting(data, null),
          isManualPRSelection: false,
          diffsByRef: {},
          diffStale: true,
          prCheckCompleted: false,
          isCheckingBranchPR: true,
        },
      };
    },
    'pr.CLEAR_ERROR': () => ({ data: { prError: null } }),
  },
});
