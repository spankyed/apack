import { expect, it } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { createSettingsMachine, type SettingsEvents } from '../../../../src/features/settings/fe/machine.ts';

function startSettings() {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({ tell: () => {}, ask: () => () => {}, follow: () => ({ stop: () => {} }) });
  const handle = sys.start('host/settings', createSettingsMachine({ async reset() {}, restart() {}, report() {} }));
  return {
    read: () => sys.read(handle),
    send: (event: SettingsEvents) => sys.send(handle, event),
    cleanup: () => {
      guard.assertNone();
      sys.stop();
      guard[Symbol.dispose]();
    },
  };
}

it('opens Help independently of settings loading', () => {
  const ctx = startSettings();
  try {
    ctx.send({ type: 'HELP.OPEN', target: { packId: 'pack', articleId: 'start' } });
    expect(ctx.read().data).toMatchObject({ activeTab: 'help', help: { target: { packId: 'pack', articleId: 'start' } } });
  } finally {
    ctx.cleanup();
  }
});

it('preserves an unavailable article through help catalog refreshes', () => {
  const ctx = startSettings();
  try {
    ctx.send({ type: 'HELP.OPEN', target: { packId: 'pack', articleId: 'start' } });
    ctx.send({ type: 'HELP_CATALOG', catalog: { articles: [], problems: [] } });
    expect(ctx.read().data.help).toMatchObject({ target: { packId: 'pack', articleId: 'start' }, loading: false });
    expect(ctx.read().at).toBe('idle');
  } finally {
    ctx.cleanup();
  }
});

it('keeps feature filters while searching and restores the search after reading an article', () => {
  const ctx = startSettings();
  try {
    ctx.send({ type: 'HELP.OPEN', target: { packId: 'pack', featureId: 'code' } });
    ctx.send({ type: 'HELP.SEARCH', query: 'permissions' });
    ctx.send({ type: 'HELP.READ', packId: 'pack', articleId: 'token' });
    expect(ctx.read().data.help.target.featureId).toBe('code');
    ctx.send({ type: 'HELP.BACK' });
    expect(ctx.read().data.help).toMatchObject({ target: { packId: 'pack', featureId: 'code' }, query: 'permissions', history: [] });
    ctx.send({ type: 'HELP.OPEN', target: {} });
    expect(ctx.read().data.help).toMatchObject({ target: {}, query: '', history: [] });
  } finally {
    ctx.cleanup();
  }
});
