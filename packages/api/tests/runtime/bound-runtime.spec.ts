// The API's composition binds the app the SDK reaches: its root event bus, its version, the engine, the
// registered packs and the host services over the store openAppStore opened
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-bound-runtime-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { database: store, engine, packs } = openAppStore();
const { boundHost } = await import('@apackdev/sdk/runtime/internals');
const { getAppVersion } = await import('@apackdev/sdk/env');
const { createActionEmitter } = await import('@apackdev/sdk/services');
const { services } = boundHost();
const { untypedSendToSystem } = await import('@apackdev/sdk/events');
const { boundEars } = await import('@apackdev/sdk/ears');
const { repository } = await import('@apackdev/sdk/services');
const { registerPack, unregisterPack } = packs;
const { rootEvents } = await import('../../src/transport/emitter.ts');
/** The app version the composition binds: the root package.json's */
const APP_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')).version;

afterAll(() => {
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('the bound app', () => {
  it("is the API's bus and version, and the engine it created, bound", () => {
    expect(boundHost().transport.rootEvents).toBe(rootEvents);
    expect(getAppVersion()).toBe(APP_VERSION);
    expect(boundHost().ears).toBe(engine);
    expect(boundHost().packs).toBe(packs);
    expect(boundEars()).toBe(engine);
    // The repositories are the registered packs': none is registered here, so a read names the one asked for
    expect(() => repository.boundQueries).toThrow('"boundQueries" is not registered');
  });

  it('has the host services over the opened store', async () => {
    expect(services.runHistory.findRuns()).toEqual([]);
    expect(services.secrets.status().protection).toBeDefined();
    expect(services.secrets.list()).toEqual([]);
    await expect(services.appData.readBackupSummary(dataDir)).resolves.toBeNull();
    await expect(services.inference.generateText({ model: 'openai:gpt-5', prompt: 'hi' })).rejects.toThrow(/key/i);
  });

  it("reads the registered packs' services and systems", () => {
    packs.catalog.setNative([...packs.catalog.getSnapshot().native, { id: 'bound-pack', eventContracts: { memos: { system: { incoming: ['PING'], outgoing: [] } } }, services: { memoService: 'fixtures/services.ts#memoService' }, features: { memos: { description: 'Feature declaration fixture.',} } }]);
    const memoService = { ping: () => 'pong' };
    registerPack({ id: 'bound-pack', features: { memos: { system: { machine: {} as never, receives: ['PING'] } } }, services: { memoService } });
    const incoming: unknown[] = [];
    const stop = rootEvents.onIncoming((event) => { incoming.push(event); });
    try {
      expect(boundHost().packs.getRegisteredServices().memoService).toBe(memoService);
      createActionEmitter().sendToSystem('bound-pack/memos', { type: 'PING' });
      untypedSendToSystem('bound-pack/memos', { type: 'PING' });
    } finally {
      stop();
      unregisterPack('bound-pack');
    }
    expect(incoming).toEqual([{ to: 'bound-pack/memos', call: expect.any(String), event: { type: 'PING' } }, { to: 'bound-pack/memos', call: expect.any(String), event: { type: 'PING' } }]);
  });
});
