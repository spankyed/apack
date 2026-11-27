import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { system as createStateSystem } from '@apackdev/state';
import { defectGuard } from '@apackdev/state/testing';
import { isState } from '@apackdev/sdk/framework';
import { boundEars } from '@apackdev/sdk/ears';
import { AppDataBusyError } from '@apackdev/sdk/services';
import { resetTestData, startTestRuntime, testRootEvents } from '@apackdev/sdk/testing';
import { createNativePackTestRegistry } from '@apackdev/host/testing';
import { HOST_ENTITY_TYPES } from '../../../../src/app-state/index.ts';
import { createSettingsStore } from '../../../../src/features/settings/be/store.ts';
import { createSettingsService } from '../../../../src/services/settings.ts';
import { bindSettingsRequest } from '../../../../src/features/settings/be/access.ts';
import { settingsSystem } from '../../../../src/features/settings/be/system.ts';
import { HOST } from '../../../../src/refs.ts';

const registry = createNativePackTestRegistry();
const store = createSettingsStore({
  ears: boundEars,
  catalog: registry.settingsCatalog,
  onCatalogChanged: registry.onCatalogChanged,
});
const admin = createSettingsService(store);

let resetMock = vi.fn<() => Promise<void>>(async () => {});

startTestRuntime({
  packs: registry,
  settings: admin,
  entityTypes: HOST_ENTITY_TYPES,
  serviceOverrides: new Map<string, unknown>([
    ['appData', { reset: () => resetMock() }],
    ['secrets', { list: () => [], status: () => ({ available: true, backend: 'keychain' }) }],
  ]),
});

type SentBroadcast = { to: string; event: { type: string; [key: string]: unknown } };
type SentPeer = { peer: string; event: { type: string; [key: string]: unknown } };

function runSettingsSystem() {
  const broadcasts: SentBroadcast[] = [];
  const peers: SentPeer[] = [];
  const guard = defectGuard();
  const sys = createStateSystem({ side: 'backend', onDefect: guard.onDefect });
  sys.attach({
    tell: (to, event) => { broadcasts.push({ to, event: event as SentBroadcast['event'] }); },
    ask: (_to, _name, _args, _progress, done) => {
      done({ ok: false, failure: { kind: 'unavailable', message: 'unused' } });
      return () => {};
    },
    follow: (_feature, _view, _args, _updated, failed) => {
      failed({ kind: 'unavailable', message: 'unused' });
      return { stop: () => {} };
    },
  });
  sys.attach('role:brain', {
    tell: (peer, event) => { peers.push({ peer, event: event as SentPeer['event'] }); },
  });
  expect(isState(settingsSystem)).toBe(true);
  const handle = sys.start(HOST.settings, settingsSystem);
  const stop = () => {
    sys.stop();
    guard.assertNone();
    guard[Symbol.dispose]();
  };
  return { sys, handle, broadcasts, peers, stop };
}

const featureDef = {
  defaults: { count: 1 },
  schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] },
};

beforeEach(() => {
  resetTestData();
  resetMock = vi.fn(async () => {});
  registry.registerPack({
    id: 'demo',
    features: {
      panel: { settings: featureDef },
    },
  });
});

afterEach(() => {
  if (registry.getPackRegistration('demo')) registry.unregisterPack('demo');
});

describe('host settings system (@apackdev/state)', () => {
  it('publishes startup settings/hotkeys/secrets on SEND_STATE and SECRETS_CHANGED, and serves GET_SETTINGS', async () => {
    const run = runSettingsSystem();
    try {
      run.sys.send(run.handle, { type: 'SEND_STATE' });
      expect(run.broadcasts.map((b) => [b.to, b.event.type])).toEqual([
        [HOST.settings, 'SETTINGS_LOADED'],
        [HOST.application, 'APPLICATION_HOTKEYS'],
        [HOST.settings, 'SECRETS_UPDATED'],
      ]);

      run.broadcasts.length = 0;
      run.sys.send(run.handle, { type: 'SECRETS_CHANGED' });
      expect(run.broadcasts.map((b) => [b.to, b.event.type])).toEqual([
        [HOST.settings, 'SECRETS_UPDATED'],
      ]);

      const read = await run.sys.ask(run.handle, 'GET_SETTINGS', {});
      expect(read).toEqual({
        ok: true,
        value: { snapshot: expect.objectContaining({ status: 'ready' }) },
      });
    } finally {
      run.stop();
    }
  });

  it('notifies changed features on settings writes and unsubscribes on exit', () => {
    const featureTells: Array<{ to: string; event: Record<string, unknown> }> = [];
    const featureBroadcasts: Array<{ to: string; event: Record<string, unknown> }> = [];
    const stopIn = testRootEvents.onIncoming((msg) => featureTells.push({ to: msg.to, event: msg.event }));
    const stopOut = testRootEvents.onSurfaceSend((msg) => featureBroadcasts.push({ to: msg.to, event: msg.event }));
    const run = runSettingsSystem();
    try {
      admin.set({ kind: 'feature', featureRef: 'demo/panel' }, ['count'], 2);

      expect(run.broadcasts.map((b) => [b.to, b.event.type])).toEqual([
        [HOST.settings, 'SETTINGS_UPDATED'],
        [HOST.application, 'APPLICATION_HOTKEYS'],
      ]);
      expect(featureTells).toContainEqual({
        to: 'demo/panel',
        event: expect.objectContaining({ type: 'FEATURE_SETTINGS_UPDATED', settings: { count: 2 } }),
      });
      expect(featureBroadcasts).toContainEqual({
        to: 'demo/panel',
        event: { type: 'FEATURE_SETTINGS_UPDATED', settings: { count: 2 } },
      });

      run.stop();
      run.broadcasts.length = 0;
      featureTells.length = 0;
      admin.set({ kind: 'feature', featureRef: 'demo/panel' }, ['count'], 3);
      expect(run.broadcasts).toEqual([]);
      expect(featureTells).toEqual([]);
    } finally {
      stopIn();
      stopOut();
    }
  });

  it('refuses mutations and resets while replacing data, then broadcasts every feature with changes: null once replaced', async () => {
    const featureTells: Array<{ to: string; event: Record<string, unknown> }> = [];
    const stopIn = testRootEvents.onIncoming((msg) => featureTells.push({ to: msg.to, event: msg.event }));
    const run = runSettingsSystem();
    try {
      let release!: () => void;
      const replacing = admin.whileReplacingData(async () => {
        await new Promise<void>((resolve) => { release = resolve; });
      });

      expect(run.sys.read(run.handle).at).toBe('replacingData');

      const updateArgs = { target: { kind: 'feature' as const, featureRef: 'demo/panel' as const }, path: ['count'], value: 9 };
      bindSettingsRequest(updateArgs, () => ({ kind: 'host', service: admin }));
      const refused = await run.sys.ask(run.handle, 'UPDATE_SETTINGS', updateArgs);
      expect(refused).toEqual({
        ok: false,
        failure: {
          kind: 'refused',
          message: expect.stringContaining('being replaced'),
          problems: [expect.stringContaining('being replaced')],
        },
      });

      // Reads remain available while replacing
      expect(await run.sys.ask(run.handle, 'GET_SETTINGS', {})).toMatchObject({ ok: true });

      run.broadcasts.length = 0;
      run.sys.send(run.handle, { type: 'RESET_APP' });
      expect(run.broadcasts).toContainEqual({
        to: HOST.settings,
        event: { type: 'APP_RESET_FAILED', error: expect.stringContaining('being replaced') },
      });

      release();
      await replacing;

      expect(run.sys.read(run.handle).at).toBe('idle');
      expect(featureTells).toContainEqual({
        to: 'demo/panel',
        event: { type: 'FEATURE_SETTINGS_UPDATED', settings: { count: 1 }, changes: null },
      });
    } finally {
      run.stop();
      stopIn();
    }
  });

  it('refuses unauthorized RESET_APP and handles authorized reset success, busy refusal, and partial failure', async () => {
    const run = runSettingsSystem();
    try {
      // Unauthorized reset is refused immediately
      run.sys.send(run.handle, { type: 'RESET_APP' });
      expect(run.sys.read(run.handle).at).toBe('idle');
      expect(run.broadcasts).toContainEqual({
        to: HOST.settings,
        event: { type: 'APP_RESET_FAILED', error: expect.stringContaining('host-issued settings administration') },
      });

      // Authorized reset succeeds: restarts brain and broadcasts APP_RESET_COMPLETE
      let finishReset!: () => void;
      resetMock = vi.fn(() => new Promise<void>((resolve) => { finishReset = resolve; }));
      const okReset = { type: 'RESET_APP' as const };
      bindSettingsRequest(okReset, () => ({ kind: 'host', service: admin }));
      run.broadcasts.length = 0;
      run.sys.send(run.handle, okReset);
      expect(run.sys.read(run.handle).at).toBe('resetting');

      // Settings mutations are refused while resetting
      const duringReset = { target: { kind: 'feature' as const, featureRef: 'demo/panel' as const }, path: ['count'], value: 5 };
      bindSettingsRequest(duringReset, () => ({ kind: 'host', service: admin }));
      expect(await run.sys.ask(run.handle, 'UPDATE_SETTINGS', duringReset)).toEqual({
        ok: false,
        failure: {
          kind: 'refused',
          message: expect.stringContaining('being reset'),
          problems: [expect.stringContaining('being reset')],
        },
      });

      finishReset();
      await vi.waitFor(() => expect(run.sys.read(run.handle).at).toBe('idle'));
      expect(run.peers).toEqual([{ peer: 'role:brain', event: { type: 'RESTART_BRAIN' } }]);
      expect(run.broadcasts).toContainEqual({ to: HOST.settings, event: { type: 'APP_RESET_COMPLETE' } });

      // Busy error: broadcasts APP_RESET_FAILED and returns to idle without restarting brain
      run.broadcasts.length = 0;
      run.peers.length = 0;
      resetMock = vi.fn(async () => { throw new AppDataBusyError('Another reset is running'); });
      const busyReset = { type: 'RESET_APP' as const };
      bindSettingsRequest(busyReset, () => ({ kind: 'host', service: admin }));
      run.sys.send(run.handle, busyReset);
      await vi.waitFor(() => expect(run.sys.read(run.handle).at).toBe('idle'));
      expect(run.peers).toEqual([]);
      expect(run.broadcasts).toEqual([{
        to: HOST.settings,
        event: { type: 'APP_RESET_FAILED', error: 'Another reset is running' },
      }]);

      // Partial failure: broadcasts SETTINGS_UPDATED + APP_RESET_FAILED and returns to idle
      run.broadcasts.length = 0;
      resetMock = vi.fn(async () => { throw new Error('disk full'); });
      const partialReset = { type: 'RESET_APP' as const };
      bindSettingsRequest(partialReset, () => ({ kind: 'host', service: admin }));
      run.sys.send(run.handle, partialReset);
      await vi.waitFor(() => expect(run.sys.read(run.handle).at).toBe('idle'));
      expect(run.broadcasts).toContainEqual({ to: HOST.settings, event: { type: 'APP_RESET_FAILED', error: 'disk full' } });
      expect(run.broadcasts.some((b) => b.event.type === 'SETTINGS_UPDATED')).toBe(true);
    } finally {
      run.stop();
    }
  });

  it('reconciles PACK_CHANGED arriving during resetting when AppDataBusyError returns to idle', async () => {
    const featureTells: Array<{ to: string; event: Record<string, unknown> }> = [];
    const stopIn = testRootEvents.onIncoming((msg) => featureTells.push({ to: msg.to, event: msg.event }));
    const run = runSettingsSystem();
    try {
      let rejectBusy!: (err: Error) => void;
      resetMock = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectBusy = reject; }));

      const busyReset = { type: 'RESET_APP' as const };
      bindSettingsRequest(busyReset, () => ({ kind: 'host', service: admin }));
      run.broadcasts.length = 0;
      run.sys.send(run.handle, busyReset);
      expect(run.sys.read(run.handle).at).toBe('resetting');

      // Register a second pack and send PACK_CHANGED while still resetting
      registry.registerPack({
        id: 'late-pack',
        features: {
          panel: { settings: { defaults: { mode: 'fast' }, schema: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] } } },
        },
      });
      run.sys.send(run.handle, { type: 'PACK_CHANGED', packId: 'late-pack' });
      expect(featureTells).toEqual([]);

      // Reset never started (AppDataBusyError): returning to idle reconciles the pack change
      rejectBusy(new AppDataBusyError('Another reset is running'));
      await vi.waitFor(() => expect(run.sys.read(run.handle).at).toBe('idle'));

      expect(run.broadcasts).toContainEqual({ to: HOST.settings, event: { type: 'APP_RESET_FAILED', error: 'Another reset is running' } });
      expect(run.broadcasts.some((b) => b.event.type === 'SETTINGS_UPDATED')).toBe(true);
      expect(featureTells).toContainEqual({
        to: 'late-pack/panel',
        event: expect.objectContaining({ type: 'FEATURE_SETTINGS_UPDATED', settings: { mode: 'fast' } }),
      });
    } finally {
      run.stop();
      stopIn();
      if (registry.getPackRegistration('late-pack')) registry.unregisterPack('late-pack');
    }
  });
});
