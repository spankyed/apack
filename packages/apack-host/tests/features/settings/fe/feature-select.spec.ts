// The settings surface shows the settings of the surface FEATURE.SELECT names. Any pack can send it (with
// openSurface), so it takes a feature's ref: a bare name would be read as this pack's surface. A bad one is reported
// and ignored, rather than stopping the settings surface.
import { afterEach, expect, it, vi } from 'vitest';
import { system } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { resolveName } from '@apackdev/sdk/ids';
import { createSettingsMachine, type SettingsEvents } from '../../../../src/features/settings/fe/machine.ts';

afterEach(() => vi.restoreAllMocks());

function readySettingsSurface() {
  const guard = defectGuard();
  const sys = system({ side: 'window', onDefect: guard.onDefect });
  sys.attach({ tell: () => {}, ask: () => () => {}, follow: () => ({ stop: () => {} }) });
  const handle = sys.start('host/settings', createSettingsMachine({ reset: async () => {}, restart: () => {}, report: () => {} }));
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

it('selects the surface a ref names', () => {
  const ctx = readySettingsSurface();
  try {
    ctx.send({ type: 'FEATURE.SELECT', featureId: resolveName('e2e-fixture/memos') });
    expect(ctx.read().data.selectedFeatureId).toBe('e2e-fixture/memos');
  } finally {
    ctx.cleanup();
  }
});

it('ignores and reports a bare name, keeping what was selected and running on', () => {
  const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ctx = readySettingsSurface();
  try {
    ctx.send({ type: 'FEATURE.SELECT', featureId: resolveName('default-setup/logs') });

    ctx.send({ type: 'FEATURE.SELECT', featureId: 'memos' as never });

    expect(ctx.read().data.selectedFeatureId).toBe('default-setup/logs');
    expect(ctx.read().at).toBe('idle');
    expect(reported).toHaveBeenCalledWith(expect.stringContaining(`"memos", which isn't a feature's ref`));
  } finally {
    ctx.cleanup();
  }
});
