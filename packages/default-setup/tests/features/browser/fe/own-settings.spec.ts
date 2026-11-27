// The browser feature holds its own settings, as the other nine do. It was the one feature that never handled
// `FEATURE_SETTINGS_UPDATED`, so it reached into the settings surface's actor instead — from a machine action,
// where no composable can run. That is what this replaces.
import { describe, expect, it } from 'vitest';
import { system, type EventsOf } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import browserState from '#features/browser/fe/state.ts';

const started = () => {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({
    tell: () => {},
    ask: () => () => {},
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'not used' });
      return { stop: () => {} };
    },
  });
  const handle = sys.start('default-setup/browser', browserState);
  return {
    read: () => sys.read(handle),
    send: (event: EventsOf<typeof browserState>) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
};

describe("the browser surface's own settings", () => {
  it('starts with none and takes them from the app', () => {
    const ctx = started();
    try {
      expect(ctx.read().data.settings).toEqual({});

      ctx.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { showBookmarksBar: false, openLinksInApp: false } });

      expect(ctx.read().data.settings).toEqual({ showBookmarksBar: false, openLinksInApp: false });
    } finally {
      ctx.cleanup();
    }
  });

  it('keeps the last settings the app sent', () => {
    const ctx = started();
    try {
      ctx.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { showBookmarksBar: true, openLinksInApp: true } });
      ctx.send({ type: 'FEATURE_SETTINGS_UPDATED', settings: { showBookmarksBar: false, openLinksInApp: true } });

      expect(ctx.read().data.settings.showBookmarksBar).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});
