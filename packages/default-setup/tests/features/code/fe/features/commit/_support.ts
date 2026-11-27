// Shared @apackdev/state harness for the 7-state commit machine specs.
import type { Value } from '@apackdev/state';
import {
  commitState,
  composerState,
  historyState,
  recoveryState,
  remotesState,
  stashesState,
  worktreesState,
  type CommitShape,
  type OpenDiffRef,
} from '#features/code/fe/features/commit/state.ts';
import { startMachine } from '../../_support/asks.ts';

export const COMMIT_REPORTS = [
  'OPEN_DIFF_TAB',
  'ACTIVATE_DIFF_TAB',
  'REFRESH_DIFF_TAB',
  'OPEN_FILE_TAB',
] as const;

type OpenCommitValue = Extract<Value<CommitShape>, { at: 'open' }>;

export function startCommit(options: {
  directory?: string | null;
  openDiffs?: OpenDiffRef[];
  resetAfterOpen?: boolean;
} = {}) {
  const h = startMachine(commitState, { reports: COMMIT_REPORTS });
  const dir = options.directory === undefined ? '/work/one' : options.directory;
  if (dir !== null) {
    h.send({ type: 'CODE_STARTED', directory: dir });
    if (options.openDiffs) h.send({ type: 'OPEN_DIFFS_CHANGED', openDiffs: options.openDiffs });
    if (options.resetAfterOpen !== false) h.reset();
  } else if (options.openDiffs) {
    h.send({ type: 'OPEN_DIFFS_CHANGED', openDiffs: options.openDiffs });
  }

  const open = (): OpenCommitValue => {
    const snap = h.read();
    if (snap.at !== 'open') throw new Error(`expected commit to be open, was ${snap.at}`);
    return snap;
  };

  return {
    ...h,
    root: () => h.read(),
    open,
    composer: () => h.child('composer') as { data: any; pending: any },
    recovery: () => h.child('recovery') as { data: any; pending: any },
    history: () => h.child('history') as { data: any; pending: any },
    remotes: () => h.child('remotes') as { data: any; pending: any },
    stashes: () => h.child('stashes') as { data: any; pending: any },
    worktrees: () => h.child('worktrees') as { data: any; pending: any },
  };
}

export type CommitHarness = ReturnType<typeof startCommit>;
export { composerState, historyState, recoveryState, remotesState, stashesState, worktreesState };
