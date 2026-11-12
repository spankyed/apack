import { afterEach, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import * as os from 'node:os';
import { gitWatcherActor } from '../../../../src/features/code/be/git-watcher-actor.ts';
import { GitRepository } from '../../../../src/features/code/be/git/index.ts';

const actors: Array<{ stop(): void }> = [];
afterEach(() => { actors.splice(0).forEach(actor => actor.stop()); vi.restoreAllMocks(); });
const repository = new GitRepository(os.tmpdir());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
function watcher() {
  let change: (paths: string[] | null) => void = () => {};
  return {
    setGitRepository: vi.fn(),
    setChangeCallback: (callback: (paths: string[] | null) => void) => { change = callback; },
    startWatching: vi.fn(async (_signal?: AbortSignal) => {}),
    stopWatching: vi.fn(async () => {}),
    change: () => change(null),
  };
}
function start(selected: ReturnType<typeof watcher>) {
  const onChange = vi.fn();
  const actor = createActor(gitWatcherActor, { input: { watcher: selected, repository, onChange } }).start();
  actors.push(actor);
  return { actor, onChange };
}

it('cancels pending startup and closes its resource after the owner stops', async () => {
  const ready = deferred();
  const selected = watcher();
  selected.startWatching.mockImplementation(() => ready.promise);
  const { actor, onChange } = start(selected);
  await expect.poll(() => selected.startWatching.mock.calls.length).toBe(1);
  actor.stop();
  expect(selected.startWatching.mock.calls[0][0]?.aborted).toBe(true);
  expect(selected.stopWatching).toHaveBeenCalledTimes(1);
  selected.change();
  expect(onChange).not.toHaveBeenCalled();
  ready.resolve();
  await expect.poll(() => selected.stopWatching.mock.calls.length).toBe(1);
  selected.change();
  expect(onChange).not.toHaveBeenCalled();
});

it('finishes closing the previous resource before starting the latest selection', async () => {
  const closed = deferred();
  const first = watcher(), superseded = watcher(), latest = watcher();
  first.stopWatching.mockImplementation(() => closed.promise);
  const { actor, onChange } = start(first);
  await expect.poll(() => first.startWatching.mock.calls.length).toBe(1);
  actor.send({ type: 'WATCH', selection: { watcher: superseded, repository } });
  actor.send({ type: 'WATCH', selection: { watcher: latest, repository } });
  await expect.poll(() => first.stopWatching.mock.calls.length).toBe(1);
  first.change();
  expect(onChange).not.toHaveBeenCalled();
  expect(latest.startWatching).not.toHaveBeenCalled();
  closed.resolve();
  await expect.poll(() => latest.startWatching.mock.calls.length).toBe(1);
  expect(superseded.startWatching).not.toHaveBeenCalled();
  latest.change();
  expect(onChange).toHaveBeenCalledTimes(1);
  actor.stop();
  await expect.poll(() => latest.stopWatching.mock.calls.length).toBe(1);
});

it('closes failed startup and accepts a later selection without reviving failed callbacks', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const failed = watcher(), next = watcher();
  failed.startWatching.mockRejectedValue(new Error('Cannot start watching'));
  const { actor, onChange } = start(failed);
  await expect.poll(() => failed.stopWatching.mock.calls.length).toBe(1);
  failed.change();
  expect(onChange).not.toHaveBeenCalled();
  actor.send({ type: 'WATCH', selection: { watcher: next, repository } });
  await expect.poll(() => next.startWatching.mock.calls.length).toBe(1);
  next.change();
  expect(onChange).toHaveBeenCalledTimes(1);
});
