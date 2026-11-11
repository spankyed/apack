// What a subscriber reports of what its platform's watcher tells it. The platform is stood in for: whether it
// delivers at all is the platform's to answer, and a case waiting on it would pass only on a quiet machine.
import { expect, it } from 'vitest';
import * as path from 'node:path';
import {
  nodeSubscriber, parcelSubscriber, type ParcelSubscribe, type WatchedChange, type WatchTree,
} from '../../../../../src/features/code/be/services/directory-watch.ts';

const directory = path.resolve('checkout');

/** Stands in for `fs.watch`: a case says what the platform reports */
function platformWatch() {
  const platform = { closed: false, reports: (_filename: string | null) => {}, fails: (_error: Error) => {} };
  const watch: WatchTree = (_directory, _options, listener) => {
    platform.reports = filename => listener('change', filename);
    return { on: (_event, onError) => { platform.fails = onError; }, close: () => { platform.closed = true; } };
  };
  return { platform, watch };
}

/** What a subscriber told its caller, in order */
function told() {
  const calls: Array<{ error: Error | null; changes: WatchedChange[] }> = [];
  return { calls, onChanges: (error: Error | null, changes: WatchedChange[]) => { calls.push({ error, changes }); } };
}

it('reports a change by where it was, and none in a directory it was told to ignore', async () => {
  const { platform, watch } = platformWatch();
  const { calls, onChanges } = told();
  // Named the way git names them, whatever the platform separates a path with
  await nodeSubscriber(watch)(directory, onChanges, { ignore: ['node_modules', 'packages/app/dist'] });

  const reported = [
    path.join('src', 'a.ts'),
    // A sibling whose name only starts the same way is not the ignored directory
    path.join('node_modules_kept', 'index.js'),
    path.join('packages', 'app', 'src', 'a.ts'),
  ];
  const ignored = ['node_modules', path.join('node_modules', 'left-pad', 'index.js'), path.join('packages', 'app', 'dist', 'bundle.js')];
  for (const filename of [...ignored, ...reported]) platform.reports(filename);

  expect(calls.map(call => call.changes)).toEqual(reported.map(filename => [filename]));
});

it('reports a change the platform could not place as one, and its error as an error', async () => {
  const { platform, watch } = platformWatch();
  const { calls, onChanges } = told();
  await nodeSubscriber(watch)(directory, onChanges, { ignore: ['node_modules'] });

  platform.reports(null);
  const error = new Error('EPERM: operation not permitted, watch');
  platform.fails(error);

  expect(calls).toEqual([{ error: null, changes: [null] }, { error, changes: [] }]);
});

it('closes the platform’s watch when unsubscribed', async () => {
  const { platform, watch } = platformWatch();
  const subscription = await nodeSubscriber(watch)(directory, () => {}, { ignore: [] });
  expect(platform.closed).toBe(false);
  await subscription.unsubscribe();
  expect(platform.closed).toBe(true);
});

it('reports a library watch’s changes relative to its directory, and says the watch ended when the directory was deleted', async () => {
  let deliver: Parameters<ParcelSubscribe>[1] = () => {};
  const subscribe: ParcelSubscribe = async (_directory, onEvents) => {
    deliver = onEvents;
    return { unsubscribe: async () => {} };
  };
  const { calls, onChanges } = told();
  await parcelSubscriber(async () => ({ subscribe }))(directory, onChanges, { ignore: [] });

  deliver(null, [{ type: 'update', path: path.join(directory, 'src', 'a.ts') }, { type: 'delete', path: path.join(directory, 'old.ts') }]);
  // The library stops reporting on a directory once it is deleted, and never starts again for one made in its place
  deliver(null, [{ type: 'delete', path: path.join(directory, 'src', 'a.ts') }, { type: 'delete', path: directory }]);

  expect(calls[0]).toEqual({ error: null, changes: [path.join('src', 'a.ts'), 'old.ts'] });
  expect(calls[1]!.error).toBeInstanceOf(Error);
  expect(calls[1]!.changes).toEqual([]);
});
