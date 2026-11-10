import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { commitSystem } from '../../../../src/features/code/be/features/commit.ts';

const actors: Array<{ stop(): void }> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); vi.useRealTimers(); });
function start() {
  const announced = vi.fn();
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: null } }).start();
  actors.push(actor);
  return { actor, announced };
}

// Each window asks again for its status and history on the one announcement
it('coalesces repeated status changes into one announcement that the repository changed', async () => {
  const { actor, announced } = start();
  for (let i = 0; i < 3; i++) actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  await vi.advanceTimersByTimeAsync(149);
  expect(announced).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(announced).toHaveBeenCalledTimes(1);
});

it('cancels a pending refresh when the commit actor stops', async () => {
  const { actor, announced } = start();
  actor.send({ type: 'commit.GIT_STATUS_CHANGED' });
  actor.stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(150);
  expect(announced).not.toHaveBeenCalled();
});

// A write here changes the repository every window shows, so it is the same news as the watcher's, and no window
// is sent a listing it did not ask for
it('announces a write as the repository changing, and lists nothing itself', async () => {
  const announced = vi.fn();
  const listed = vi.fn();
  const gitRepository = { stashDrop: async () => {} } as never;
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced, stashList: listed } }),
    { input: { baseDirectory: '/repo', gitRepository } }).start();
  actors.push(actor);

  actor.send({ type: 'commit.STASH_DROP', index: 0 });
  await vi.advanceTimersByTimeAsync(150);

  expect(announced).toHaveBeenCalledTimes(1);
  expect(listed).not.toHaveBeenCalled();
});

// A file event or a reconcile is a hint: git says whether the repository changed, and only then is it news
it('announces a hint only when git says the repository changed, one check at a time', async () => {
  let changed = false;
  let release = () => {};
  const refreshSnapshot = vi.fn(() => new Promise<boolean>((resolve) => { release = () => resolve(changed); }));
  const announced = vi.fn();
  const actor = createActor(commitSystem.provide({ actions: { announceRepositoryChanged: announced } }),
    { input: { baseDirectory: '/repo', gitRepository: { refreshSnapshot } as never } }).start();
  actors.push(actor);

  actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  for (let i = 0; i < 3; i++) actor.send({ type: 'commit.REPOSITORY_MAY_HAVE_CHANGED' });
  expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(announced).not.toHaveBeenCalled();

  // The hints that arrived during the first check are one more
  expect(refreshSnapshot).toHaveBeenCalledTimes(2);
  changed = true;
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(announced).toHaveBeenCalledTimes(1);
  expect(refreshSnapshot).toHaveBeenCalledTimes(2);
});
