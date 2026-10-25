// Resetting the app (services.appData.reset()) leaves it as a fresh boot does: an onboarded app whose settings and
// flows were changed comes back with default settings, the built-in packs' written flows and the migrations applied
// (its data at the app version, nothing pending; tests/services/host-runtime.spec.ts in @apackdev/host shows the reset's
// order). Runs the built-in packs' built runtimes (npm run build:default-setup), as the db scripts do.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EARS } from '@apackdev/ears';
import { createActor } from 'xstate';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-app-reset-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { database: store, packs } = openAppStore();
const { loadAppPacks, startPacks } = await import('@apackdev/host/packs/runtime');
const { installShippedPacks } = await import('@apackdev/host/packs');
const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
const { appState } = await import('@apackdev/host/app-state');
const { getAppVersion } = await import('@apackdev/sdk/env');
const { _settingsAdmin } = await import('@apackdev/sdk/services');
const { boundHost } = await import('@apackdev/sdk/runtime/internals');
const { services } = boundHost();
const { flowRepository } = await import('@apackdev/sdk/repositories');
const { untypedQuery, untypedWrite } = await import('@apackdev/sdk/ears');
const { onIncoming } = await import('@apackdev/sdk/events');
const { HOST } = await import('@apackdev/host/bus');

const PACKAGES_DIR = path.resolve(__dirname, '..', '..', '..');

/** What the user changed from the defaults — the whole of what a reset has to undo */
const storedSettings = () => _settingsAdmin().getOverrides();

/** The flows' ids and labels, sorted */
const flows = () => (untypedQuery('Flow').pickAll() as Array<{ id: EARS.EntityId; label?: string }>)
  .map(({ id, label }) => ({ id, label }))
  .sort((a, b) => a.id.localeCompare(b.id));

let fresh: { settings: unknown; flows: ReturnType<typeof flows> };

beforeAll(async () => {
  const { hostRegistration, createApplicationSystem, APPLICATION_SYSTEM_EVENTS, createSettingsSystem, settingsEvents } = await import('@apackdev/host/features');
  packs.registerPack(hostRegistration({
    application: { machine: createApplicationSystem(packs), receives: APPLICATION_SYSTEM_EVENTS },
    settings: { machine: createSettingsSystem(), receives: [...settingsEvents] },
  }));
  // The API's boot, for the built-in packs
  // The app installs the packs it ships, then loads every installed pack
  await installShippedPacks(PACKAGES_DIR, resolveAppEnvironment().packsDir, { installedPacksFile: resolveAppEnvironment().installedPacksFile });
  loadAppPacks(packs);
  startPacks(packs);
  fresh = { settings: storedSettings(), flows: flows() };
});

afterAll(() => {
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('services.appData.reset()', () => {
  it('leaves an onboarded app with default settings, written flows and migrations applied', async () => {
    // A fresh boot applyed flows, and its data is at the app version
    expect(fresh.flows.length).toBeGreaterThan(0);
    expect(appState.get()).toMatchObject({ hasOnboarded: false, version: getAppVersion() });

    // The user onboards, changes settings and deletes a flow; the data records an older version
    services.onboarding.complete();
    appState.update({ version: '0.0.1' });
    _settingsAdmin().set({ kind: 'app' }, ['personal', 'name'], 'Ada');
    expect(storedSettings()).not.toEqual(fresh.settings);
    const [deleted] = fresh.flows;
    flowRepository.deleteFlow(deleted.id, { allowRoot: true });
    expect(flows()).not.toContainEqual(deleted);

    await services.appData.reset();

    expect(flows()).toEqual(fresh.flows);
    expect(storedSettings()).toEqual(fresh.settings);
    expect(appState.get()).toMatchObject({ hasOnboarded: false, version: getAppVersion() });
    expect(services.onboarding.isComplete()).toBe(false);
  });

  // Without this the Database surface refreshed itself and nothing else did, so a reset left Notes, Threads
  // and the rest rendering the previous database until the app was restarted
  it('tells the bus that every row was replaced', async () => {
    const announced: string[] = [];
    const stop = onIncoming((message) => {
      if (message.event.type === 'DATA_REPLACED') announced.push(message.to);
    });

    await services.appData.reset();
    stop();

    expect(announced).toEqual([HOST.bus]);
  });
});

it('restores unfinished onboarding and resumes it only after an explicit restart', async () => {
  const { createAppBus } = await import('@apackdev/host/bus');
  const { rootEvents } = await import('../../src/transport/emitter.ts');
  const opened: unknown[] = [];
  const unsubscribe = rootEvents.onOutgoing(({ to, event }) => {
    if (to === 'default-setup/threads' && event.type === 'LOAD_CHAT_THREAD') opened.push(event);
  });
  const bus = createActor(createAppBus(packs), { systemId: HOST.bus }).start();
  const threadId = () => untypedQuery.all().withRole('assistant_birth').ids()[0];
  const context = () => threadId() && untypedQuery.ids(threadId()).pickOne(['context'])?.context;
  try {
    rootEvents.emitConnected();
    rootEvents.emitPackClientConnected('default-setup');
    await expect.poll(() => opened.length).toBe(1);
    const id = threadId();
    expect(id).toBeDefined();
    const welcome = context() as { onboarding: Record<string, unknown> };
    const progress = { ...welcome, onboarding: { ...welcome.onboarding, step: 'projects' } };
    untypedWrite(id).set('context', progress);
    const backup = await services.appData.exportBackup(dataDir, 'unfinished-onboarding', ['lmdb']);
    untypedWrite(id).set('context', { onboarding: { step: 'changed after backup' } });
    services.onboarding.complete();

    await services.appData.importBackup(backup);
    const brain = bus.system.get('default-setup/brain');
    expect(brain.getSnapshot().matches('stopped')).toBe(true);
    expect(context()).toEqual(progress);
    expect(services.onboarding.isComplete()).toBe(false);
    rootEvents.emitPackClientConnected('default-setup');
    expect(opened).toHaveLength(1);

    brain.send({ type: 'START_BRAIN' });
    await expect.poll(() => opened.length).toBe(2);
    expect(threadId()).toBe(id);
    expect(context()).toEqual(progress);
    rootEvents.emitPackClientConnected('default-setup');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(opened).toHaveLength(2);
  } finally {
    bus.stop();
    packs.runShutdownHooks();
    unsubscribe();
  }
});
