// What a terminal's bell may show as a system notification: text of a bounded length, and nothing else. The notification
// is the main process's, so the test reads what was shown rather than whether a call was made.
import {beforeEach, describe, expect, it} from 'vitest';
import {ipcMain, notifications, resetElectronStub} from './electron-stub.ts';
import {MAX_NOTIFICATION_BODY, MAX_NOTIFICATION_TAG, MAX_NOTIFICATION_TITLE, TAG_MEMORY_MS, notificationProblem, registerNotifyHandler, showNotification} from '../src/modules/notify-access.ts';

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

  it('refuses a tag that is not text, or longer than the title may be', () => {
    expect(notificationProblem('Terminal', 'body', 42)).toMatch(/tag is not text/);
    expect(notificationProblem('Terminal', 'body', 'x'.repeat(MAX_NOTIFICATION_TAG + 1))).toMatch(/tag is longer than/);
    expect(notificationProblem('Terminal', 'body', undefined)).toBeUndefined();
    expect(notificationProblem('Terminal', 'body', 'bell:1')).toBeUndefined();
  });

  describe('one notification for one bell, however many windows heard it', () => {
    // Every unfocused window asks for the same bell with the bell's id as its tag; the handler is the one place they meet.
    let at = 0;
    const askAt = (time: number, title: unknown, body: unknown, tag?: unknown): unknown => {
      at = time;
      return ipcMain.handlers.get('notify:show')!({}, title, body, tag);
    };
    beforeEach(() => {
      at = 0;
      registerNotifyHandler(ipcMain, () => at);
    });

    it('shows the same tag asked from two windows as one notification', () => {
      expect(askAt(0, 'Terminal', 'Rang the bell', 't-1#1')).toBe(true);
      expect(askAt(400, 'Terminal', 'Rang the bell', 't-1#1')).toBe(false);
      expect(notifications.shown).toEqual([{title: 'Terminal', body: 'Rang the bell'}]);
    });

    it('shows two different tags with the same title and body, both', () => {
      expect(askAt(0, 'Terminal', 'Rang the bell', 't-1#1')).toBe(true);
      expect(askAt(400, 'Terminal', 'Rang the bell', 't-1#2')).toBe(true);
      expect(notifications.shown).toEqual([
        {title: 'Terminal', body: 'Rang the bell'},
        {title: 'Terminal', body: 'Rang the bell'},
      ]);
    });

    it('shows an ask with no tag every time', () => {
      expect(askAt(0, 'Terminal', 'Rang the bell')).toBe(true);
      expect(askAt(0, 'Terminal', 'Rang the bell')).toBe(true);
      expect(notifications.shown).toHaveLength(2);
    });

    it('shows a tag again once it is older than TAG_MEMORY_MS, and not before', () => {
      expect(askAt(0, 'Terminal', 'Rang the bell', 't-1#1')).toBe(true);
      expect(askAt(TAG_MEMORY_MS - 1, 'Terminal', 'Rang the bell', 't-1#1')).toBe(false);
      expect(askAt(TAG_MEMORY_MS, 'Terminal', 'Rang the bell', 't-1#1')).toBe(true);
      expect(notifications.shown).toHaveLength(2);
    });
  });
});
