import { expect, it } from 'vitest';
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import { createShell } from '../../../../src/fe/index.ts';
import { fakeShell, surface } from './fakes.ts';

it.each([
  { role: undefined, ids: ['host/settings', 'host/packs'], selected: 'host/settings' },
  { role: undefined, ids: ['other/notes'], selected: 'other/notes' },
  { role: 'custom/inbox' as const, ids: ['other/notes', 'custom/inbox'], selected: 'custom/inbox' },
  { role: 'backend-only/inbox' as const, ids: ['other/notes'], selected: 'other/notes' },
])('closes Welcome with the current window role $role and surfaces $ids', ({ role, ids, selected }) => {
  const shell = fakeShell({ surfaces: ids.map(surface), designations: role ? { threads: resolveName(role) } : {} });
  const app = createShell(shell.options, {}).start();
  try {
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    expect(app.getSnapshot().hasTag('welcome')).toBe(true);
    app.send({ type: 'CLOSE_DEV_LETTER' });
    expect(app.getSnapshot().status).toBe('active');
    expect(app.getSnapshot().matches('onboarding.wizard')).toBe(true);
    expect(app.getSnapshot().context.activeSurface?.id).toBe(selected);
    expect(app.getSnapshot().context.awaitingSurface).toEqual([]);
    expect(shell.notify.error).not.toHaveBeenCalled();
  } finally { app.stop(); }
});

it('resolves the role when Welcome closes, after its provider was removed', () => {
  const designations: Record<string, FeatureRef> = { threads: resolveName('custom/inbox') };
  const shell = fakeShell({ surfaces: [surface('other/notes'), surface('custom/inbox')], designations });
  const app = createShell(shell.options, {}).start();
  try {
    shell.client.connect();
    shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    delete designations.threads;
    app.send({ type: 'CLOSE_DEV_LETTER' });
    expect(app.getSnapshot().matches('onboarding.wizard')).toBe(true);
    expect(app.getSnapshot().context.activeSurface.id).toBe('other/notes');
  } finally { app.stop(); }
});


it('resolves each window independently without a process-global designation', () => {
  const windows = ['one/inbox', 'two/inbox'].map((id) => {
    const shell = fakeShell({ surfaces: [surface('host/settings'), surface(id)],
      designations: { threads: resolveName(id) },
    });
    const app = createShell(shell.options, {}).start();
    return { id, shell, app };
  });
  try {
    for (const { shell } of windows) {
      shell.client.connect();
      shell.client.receive({ to: 'host/application', event: { type: 'CLIENT_CONNECTED', hasOnboarded: false } });
    }
    for (const { id, app } of windows) {
      app.send({ type: 'CLOSE_DEV_LETTER' });
      expect(app.getSnapshot().context.activeSurface.id).toBe(id);
      expect(app.getSnapshot().matches('onboarding.wizard')).toBe(true);
    }
  } finally { windows.forEach(({ app }) => app.stop()); }
});
