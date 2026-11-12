// What a terminal's bell may show as a system notification: text of a bounded length, and nothing else. The notification
// is the main process's, so the test reads what was shown rather than whether a call was made.
import {beforeEach, describe, expect, it} from 'vitest';
import {ipcMain, notifications, resetElectronStub} from './electron-stub.ts';
import {MAX_NOTIFICATION_BODY, MAX_NOTIFICATION_TITLE, notificationProblem, registerNotifyHandler, showNotification} from '../src/modules/notify-access.ts';

beforeEach(() => resetElectronStub());

describe('what a bell may show as a system notification', () => {
  it('shows a title and body that are text, and says it did', () => {
    expect(showNotification('Terminal', 'Rang the bell')).toBe(true);
    expect(notifications.shown).toEqual([{title: 'Terminal', body: 'Rang the bell'}]);
  });

  it('refuses a title that is not text, and shows nothing', () => {
    for (const title of [undefined, null, 42, {text: 'x'}, ['x']]) {
      expect(showNotification(title, 'body'), String(title)).toBe(false);
    }
    expect(notifications.shown).toEqual([]);
  });

  it('refuses a body that is not text, and shows nothing', () => {
    expect(showNotification('Terminal', 42)).toBe(false);
    expect(notifications.shown).toEqual([]);
  });

  it('refuses a title longer than the most one holds, rather than cutting it', () => {
    const long = 'x'.repeat(MAX_NOTIFICATION_TITLE + 1);
    expect(notificationProblem(long, 'body')).toMatch(/title is longer than/);
    expect(showNotification(long, 'body')).toBe(false);
    expect(notifications.shown).toEqual([]);
  });

  it('refuses a body longer than the most one holds, rather than cutting it', () => {
    expect(showNotification('Terminal', 'x'.repeat(MAX_NOTIFICATION_BODY + 1))).toBe(false);
    expect(notifications.shown).toEqual([]);
  });

  it('shows a title of exactly the most it holds', () => {
    const full = 'x'.repeat(MAX_NOTIFICATION_TITLE);
    expect(showNotification(full, '')).toBe(true);
    expect(notifications.shown).toEqual([{title: full, body: ''}]);
  });

  it('shows nothing where the system cannot show a notification', () => {
    notifications.supported = false;
    expect(showNotification('Terminal', 'Rang the bell')).toBe(false);
    expect(notifications.shown).toEqual([]);
  });

  it('is what a window reaches when it asks over the registered channel', () => {
    registerNotifyHandler(ipcMain);
    const listener = ipcMain.handlers.get('notify:show')!;
    expect(listener, 'the channel is registered').toBeDefined();
    expect(listener({}, 'Terminal', 'Rang the bell')).toBe(true);
    expect(listener({}, 'Terminal', 7)).toBe(false);
    expect(notifications.shown).toEqual([{title: 'Terminal', body: 'Rang the bell'}]);
  });
});
