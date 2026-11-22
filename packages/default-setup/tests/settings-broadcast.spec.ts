// Reset broadcasts current values and shell hotkeys; the request outcome goes only to its caller.
import { expect, it } from 'vitest';
import { getTestSettings, startApp } from '@apackdev/testing/harness';

it('sends current shell hotkeys and settings after an app preferences reset', async () => {
  const app = await startApp({ systems: ['host/settings'] });
  await app.connect();
  const defaults = getTestSettings().getAll().app.hotkeys;
  getTestSettings().forPack('default-setup').set({ kind: 'app' }, ['hotkeys', 'switchSurfaceUp', 'key'], 'F9');
  await app.settle();
  expect(getTestSettings().getAll().app.hotkeys.switchSurfaceUp?.key).toBe('F9');
  const before = app.emitted('host/application').filter(event => event.type === 'APPLICATION_HOTKEYS').length;

  const call = await app.send('host/settings', { type: 'RESET_SETTINGS', target: { kind: 'app' } },
    { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });
  await app.nextEmit('host/settings', 'ASK_ANSWERED', { answering: call });
  await app.settle();

  expect(app.emitted('host/settings').filter(event => event.type === 'SETTINGS_UPDATED').at(-1))
    .toMatchObject({ snapshot: { values: { app: { hotkeys: defaults } } } });
  const hotkeys = app.emitted('host/application').filter(event => event.type === 'APPLICATION_HOTKEYS');
  expect(hotkeys).toHaveLength(before + 1);
  expect(hotkeys.at(-1)).toMatchObject({ hotkeys: defaults });
});
