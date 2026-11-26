// A file diff that needs content the partial clone was not given: the panel offers to download it, and the offer
// asks for the same diff again, allowed to fetch. The answer it gets is the one that opens the tab.
import { afterEach, expect, it } from 'vitest';
import type { GhPullRequest } from '#generated/types.ts';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';
import { pullRequestState } from '#features/code/fe/features/pull-request/state.ts';
import { startMachine } from '../../_support/asks.ts';

const PR_REPORTS = ['PR_OPEN_DIFF_TAB', 'PR_OPEN_FILE', 'PR_SELECT_PANEL'] as const;

const pr = { number: 1, baseRefName: 'main', headRefName: 'feature-a' } as unknown as GhPullRequest;
const file = (path: string) => ({ path, status: 'modified', staged: false }) as GitStatusFile;
const missing = { path: 'a.ts', baseBranch: 'main', headBranch: 'feature-a' };

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const h of running.splice(0)) h.stop();
});

/** A panel showing a PR, which has asked for one file's diff */
const asking = async () => {
  const h = startMachine(pullRequestState, { reports: PR_REPORTS });
  running.push(h);
  h.send({ type: 'SYNC_BASE_DIRECTORY', baseDirectory: '/repo' });
  h.send({ type: 'SYNC_PANEL_SHOWN', isPanelShown: true });
  h.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 1 });
  await h.latestAsk('pr.SELECT_PR').answer({ pr, comments: [], fetchedAt: Date.now() });
  h.send({ type: 'pr.SELECT_FILE', file: file('a.ts') });
  h.send({ type: 'pr.VIEW_DIFF', path: 'a.ts' });
  return h;
};

/** The refusal of a file diff that needs content the clone was not given */
const refuseAsMissing = (h: Awaited<ReturnType<typeof asking>>, nth = 0) =>
  h.asksOf('pr.GET_BRANCH_FILE_DIFF')[nth]!.refuse('a.ts needs content this clone was not given', { kind: 'content-missing', ...missing });

it('offers to download what the diff lacks, and asks for it again, allowed to fetch, when taken up', async () => {
  const h = await asking();

  await refuseAsMissing(h);
  expect(h.read().data.missingFileDiff).toEqual(missing);

  h.send({ type: 'pr.FETCH_MISSING_DIFF' });
  expect(h.latestAsk('pr.GET_BRANCH_FILE_DIFF').event).toEqual({ type: 'pr.GET_BRANCH_FILE_DIFF', ...missing, fetchMissing: true });
  expect(h.read().data.missingFileDiff, 'and the offer is gone').toBeNull();

  await h.asksOf('pr.GET_BRANCH_FILE_DIFF')[1]!.answer({ ...missing, staged: false });
  expect(h.reportsOf('PR_OPEN_DIFF_TAB'), 'the answer to the second ask opens the tab').toHaveLength(1);
});

it('offers nothing for a diff of a pull request since left', async () => {
  const h = await asking();
  h.send({ type: 'pr.BACK_TO_BRANCH' });

  await refuseAsMissing(h);

  expect(h.read().data.missingFileDiff).toBeNull();
});

it('drops the offer when the user moves to another file', async () => {
  const h = await asking();
  await refuseAsMissing(h);

  h.send({ type: 'pr.SELECT_FILE', file: file('b.ts') });

  expect(h.read().data.missingFileDiff).toBeNull();
});
