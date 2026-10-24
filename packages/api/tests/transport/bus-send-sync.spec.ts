// A user's action is durable without anyone asking for it: what a client's message set off synchronously commits,
// and `bus.send` then asks the store for a sync rather than leaving it to group commit's window. The window is set
// to a minute here, so a sync that arrives is the one the send asked for.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { createEarsEngine, type EARS } from '@apackdev/ears';
import { openLmdbStore } from '@apackdev/ears/lmdb';
import type { Message } from '@apackdev/sdk/events';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-bus-send-sync-'));
const store = openLmdbStore({ path: path.join(dir, 'ears-db'), syncIntervalMs: 60_000 });
const engine = createEarsEngine({ kv: store.kv, isEntityType: () => true, isRelationKind: () => true, isRole: () => true });
afterAll(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Resolves when the send has asked for its sync */
let asked!: () => void;
const syncAsked = new Promise<void>((resolve) => { asked = resolve; });

vi.mock('@apackdev/host/bus', () => ({
  HOST: { settings: 'host/settings', drive: 'host/drive' },
  // The system the message reaches writes as it handles it
  receiveClientEvent: (_registry: unknown, message: Message) => { engine.create('Note', { id: `Note-${message.event.type}` as EARS.EntityId }); },
  UnknownClientEventError: class extends Error {},
}));
vi.mock('../../src/runtime/index.ts', () => ({
  get appStore() { return { requestSync: () => { store.requestSync(); asked(); } }; },
  appPacks: { getEventValidationMap: () => new Map(), getSurfaceEventValidationMap: () => new Map() },
  appClaims: { clientFor: () => undefined },
}));
vi.mock('../../src/transport/emitter.ts', () => ({ rootEvents: { onOutgoing: () => () => {}, emitConnected: () => {}, emitPackClientConnected: () => {} } }));

const { systemBusRouter } = await import('../../src/transport/bus.ts');

it("syncs what a client's message committed, without waiting for group commit", async () => {
  const caller = systemBusRouter.createCaller({ client: 'c-one', closed: new AbortController().signal });
  await caller.send({ to: 'memo-pack/memos', event: { type: 'ADD_MEMO' } });
  await syncAsked;
  // Nothing more is owed, so this waits on the sync the send started rather than starting one
  await store.durable();
  expect(store.syncs).toBe(1);
  expect(engine.getRow('Note-ADD_MEMO' as EARS.EntityId)).toBeDefined();
});
