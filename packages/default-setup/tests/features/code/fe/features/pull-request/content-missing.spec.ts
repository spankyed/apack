// A file diff that needs content the partial clone was not given: the panel offers to download it, and the offer
// asks for the same diff again, allowed to fetch. The answer it gets is the one that opens the tab.
import { beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import type { GhPullRequest } from '#generated/types.ts';
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts';

const sendToSystem = vi.hoisted(() => vi.fn());
vi.mock('#generated/events.ts', () => ({ sendToSystem }));
const addTabToParent = vi.hoisted(() => vi.fn());
vi.mock('#features/code/fe/utils/parent-communication.ts', () => ({
  addTabToParent,
  updateParentState: vi.fn(),
  getParentContext: vi.fn(() => ({})),
  sendEventToParent: vi.fn(),
}));

const { pullRequestState } = await import('#features/code/fe/features/pull-request/state.ts');

const pr = { number: 1, baseRefName: 'main', headRefName: 'feature-a' } as unknown as GhPullRequest;
const file = (path: string) => ({ path, status: 'modified', staged: false }) as GitStatusFile;
const missing = { path: 'a.ts', baseBranch: 'main', headBranch: 'feature-a' };

/** A panel showing a PR, which has asked for one file's diff */
const asking = () => {
  const actor = createActor(pullRequestState).start();
  actor.send({ type: 'pr.SELECT_PR_BY_NUMBER', number: 1 });
  actor.send({ type: 'pr.PR_DETAILS_RECEIVED', data: { pr, comments: [], fetchedAt: Date.now() } });
  actor.send({ type: 'pr.SELECT_FILE', file: file('a.ts') });
  actor.send({ type: 'pr.VIEW_DIFF', path: 'a.ts' });
  return actor;
};
const asked = () => sendToSystem.mock.calls.map(([, event]) => event as Record<string, unknown>);

beforeEach(() => {
  sendToSystem.mockReset();
  addTabToParent.mockReset();
});

it('offers to download what the diff lacks, and asks for it again, allowed to fetch, when taken up', () => {
  const actor = asking();

  actor.send({ type: 'pr.FILE_CONTENT_MISSING', data: missing });
  expect(actor.getSnapshot().context.missingFileDiff).toEqual(missing);

  actor.send({ type: 'pr.FETCH_MISSING_DIFF' });
  expect(asked().at(-1)).toEqual({ type: 'pr.GET_BRANCH_FILE_DIFF', ...missing, fetchMissing: true });
  expect(actor.getSnapshot().context.missingFileDiff, 'and the offer is gone').toBeNull();

  actor.send({ type: 'pr.FILE_DIFF_RECEIVED', data: { ...missing, staged: false } });
  expect(addTabToParent, 'the answer to the second ask opens the tab').toHaveBeenCalledTimes(1);
});

it('offers nothing for a diff it never asked for', () => {
  const actor = asking();

  actor.send({ type: 'pr.FILE_CONTENT_MISSING', data: { ...missing, headBranch: 'someone-elses' } });

  expect(actor.getSnapshot().context.missingFileDiff).toBeNull();
});

it('drops the offer when the user moves to another file', () => {
  const actor = asking();
  actor.send({ type: 'pr.FILE_CONTENT_MISSING', data: missing });

  actor.send({ type: 'pr.SELECT_FILE', file: file('b.ts') });

  expect(actor.getSnapshot().context.missingFileDiff).toBeNull();
});
