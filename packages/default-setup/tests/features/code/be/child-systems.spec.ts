// The code system starts a child per panel (explorer, search, commit, …) plus its git watcher, each under its own
// slot ref. Stopping the code system tears down every started child and releases every ref so a reload or restart
// starts cleanly with the same child set.
import { describe, expect, it } from 'vitest';
import { system } from '@apackdev/state';
import { startApp } from '@apackdev/testing/harness';
import codeSystem from '#features/code/be/system.ts';

describe('the code system’s child systems', () => {
  it('are tracked by their own ids, and released when it stops', async () => {
    const sys = system({ side: 'backend' });
    sys.attach({
      tell: () => {},
      ask: (_to, _name, _args, _progress, done) => {
        done({ ok: false, failure: { kind: 'unavailable', message: 'unused' } });
        return () => {};
      },
      follow: (_feature, _view, _args, _updated, failed) => {
        failed({ kind: 'unavailable', message: 'unused' });
        return { stop: () => {} };
      },
    });
    sys.start('default-setup/code', codeSystem);

    const keys = Object.keys(sys.snapshot())
      .filter((ref) => ref.startsWith('default-setup/code/'))
      .map((ref) => ref.slice('default-setup/code/'.length));

    expect(keys, `children were ${JSON.stringify(keys)}`).not.toContain('undefined');
    expect(new Set(keys).size, 'each child holds its own id').toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'gitWatcher',
        'explorer',
        'search',
        'commit',
        'pr',
        'terminal',
        'github',
        'codeActions',
        'codePrompts',
      ]),
    );

    sys.stop();
    expect(Object.keys(sys.snapshot())).toEqual([]);

    // A stopped system releases every ref it and its children held, so the next start claims them cleanly
    const app = await startApp({ systems: ['code'] });
    app.stop();
    const restarted = await startApp({ systems: ['code'] });
    const startAnswer = await restarted.ask('code', { type: 'GET_CODE_START' });
    expect(startAnswer).toMatchObject({ ok: true });
    restarted.stop();
  });
});
