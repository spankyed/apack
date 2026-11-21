import { afterEach, expect, it, vi } from 'vitest';
import type { Message } from '@apackdev/sdk/events';
import type { SettingsSnapshot } from '@apackdev/sdk/types';
import { createWindowSettingsRuntime } from '../../src/fe/settings-runtime.ts';
import { createContributionCatalog } from '../../src/packs/catalog.ts';
import { appSettingsDefinition } from '../../src/features/settings/be/app-definition.ts';

const target = { kind: 'app' } as const;
const snapshot = (runId = 'run-one', revision = 0): SettingsSnapshot => ({
  runId, revision, status: 'ready',
  catalog: { ...createContributionCatalog(appSettingsDefinition).settings(), dependencies: { owner: [] } },
  values: { app: structuredClone(appSettingsDefinition.defaults) as unknown as SettingsSnapshot['values']['app'], packs: {}, features: {} },
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

async function windowRuntime(initial = snapshot()) {
  const messages: Message[] = [];
  const runtime = createWindowSettingsRuntime({ send: async message => { messages.push(message); } });
  runtime.connected();
  await flush();
  runtime.receive({ to: 'host/settings', event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot: initial } }, answering: messages[0].call });
  return { runtime, messages };
}

it('loads and follows settings before any Settings view or shell actor exists', async () => {
  const { runtime } = await windowRuntime();
  const changed = vi.fn();
  const stop = runtime.port.subscribe(changed);
  expect(runtime.port.status()).toBe('ready');
  expect(runtime.port.get(target)).toMatchObject({ projects: [] });
  const next = snapshot('run-one', 1);
  next.values.app.personal.name = 'Ada';
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: next } });
  expect(runtime.port.get(target)).toMatchObject({ personal: { name: 'Ada' } });
  stop();
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: snapshot('run-one', 2) } });
  expect(changed).toHaveBeenCalledTimes(1);
  runtime.dispose();
});

it('settles concurrent changes only from their own correlated reply', async () => {
  const { runtime, messages } = await windowRuntime();
  const first = runtime.port.update(target, ['personal', 'name'], 'Ada');
  const second = runtime.port.update(target, ['personal', 'phoneNumber'], '123');
  await flush();
  expect(messages[1].call).not.toBe(messages[2].call);
  runtime.receive({ to: 'host/settings', answering: messages[2].call, event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: runtime.getSnapshot() } } });
  expect(await second).toEqual({ status: 'saved' });
  runtime.receive({ to: 'host/settings', answering: messages[1].call, event: { type: 'ASK_FAILED', asked: 'UPDATE_SETTINGS', failure: { kind: 'refused', message: 'refused', problems: ['invalid name'] } } });
  expect(await first).toEqual({ status: 'refused', problems: ['invalid name'] });
  runtime.dispose();
});

it('sends a value comparison and does not treat an acknowledgement as new settings', async () => {
  const { runtime, messages } = await windowRuntime();
  const write = runtime.port.update(target, ['projects'], []);
  await flush();
  expect(messages[1].event).toMatchObject({ condition: { runId: 'run-one', expected: { exists: true, value: [] } } });
  runtime.receive({ to: 'host/settings', answering: messages[1].call, event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: runtime.getSnapshot() } } });
  await write;
  expect(runtime.getSnapshot()?.revision).toBe(0);
  runtime.dispose();
});

it('refuses in-flight requests on disconnect and accepts a new run only under its fresh read call', async () => {
  const { runtime, messages } = await windowRuntime();
  const write = runtime.port.reset(target);
  await flush();
  runtime.disconnected();
  expect((await write).status).toBe('refused');
  expect(runtime.port.get(target)).toBeUndefined();
  runtime.connected();
  await flush();
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: snapshot('run-one', 9) } });
  expect(runtime.port.status()).toBe('loading');
  runtime.receive({ to: 'host/settings', answering: messages.at(-1)!.call, event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot: snapshot('run-two') } } });
  expect(runtime.getSnapshot()?.runId).toBe('run-two');
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: snapshot('run-one', 99) } });
  expect(runtime.getSnapshot()?.runId).toBe('run-two');
  runtime.dispose();
});

it('ignores stale value or declaration revisions and owns its read snapshots', async () => {
  const initial = snapshot('run-one', 3);
  initial.catalog = { ...initial.catalog, revision: 5 };
  const { runtime } = await windowRuntime(initial);
  const staleValue = snapshot('run-one', 2);
  staleValue.catalog = { ...staleValue.catalog, revision: 6 };
  const staleCatalog = snapshot('run-one', 4);
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: staleValue } });
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: staleCatalog } });
  expect(runtime.getSnapshot()?.revision).toBe(3);
  runtime.port.get<{ personal: { name?: string } }>(target)!.personal.name = 'Changed';
  runtime.getSnapshot()!.values.app.personal.name = 'Changed too';
  expect(runtime.port.get(target)).toMatchObject({ personal: {} });
  runtime.dispose();
});

it('does not send queued requests after disposal and settles every pending caller', async () => {
  const { runtime, messages } = await windowRuntime();
  const write = runtime.port.reset(target);
  runtime.dispose();
  await flush();
  expect((await write).status).toBe('refused');
  expect(messages).toHaveLength(1);
  runtime.connected();
  expect(runtime.port.status()).toBe('disposed');
});

it('terminates timed-out reads and writes', async () => {
  vi.useFakeTimers();
  const runtime = createWindowSettingsRuntime({ send: async () => {}, timeoutMs: 10 });
  runtime.connected();
  await vi.advanceTimersByTimeAsync(11);
  expect(runtime.port.status()).toBe('disconnected');
  runtime.dispose();
  const ready = await windowRuntime();
  const write = ready.runtime.port.reset(target);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await write).toMatchObject({ status: 'refused', problems: [expect.stringContaining('did not answer')] });
  ready.runtime.dispose();
});

it('keeps two window outcomes independent while both follow broadcast values', async () => {
  const first = await windowRuntime();
  const second = await windowRuntime();
  const write = first.runtime.port.reset(target);
  await flush();
  const reply = { to: 'host/settings', answering: first.messages[1].call, event: { type: 'ASK_ANSWERED', asked: 'RESET_SETTINGS', answer: { snapshot: first.runtime.getSnapshot() } } };
  second.runtime.receive(reply);
  first.runtime.receive(reply);
  expect(await write).toEqual({ status: 'saved' });
  const next = snapshot('run-one', 1);
  next.values.app.personal.name = 'Shared';
  for (const window of [first, second]) {
    window.runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: next } });
    expect(window.runtime.port.get(target)).toMatchObject({ personal: { name: 'Shared' } });
    window.runtime.dispose();
  }
});


it('correlates whole-document replacement and keeps the caller draft after refusal', async () => {
  const { runtime, messages } = await windowRuntime();
  const draft = structuredClone(runtime.getSnapshot()!.values);
  draft.app.personal.name = 'Draft';
  const condition = { runId: 'run-one', expected: { exists: true, value: snapshot().values } };
  const write = runtime.replaceAll(draft, condition);
  await flush();
  expect(messages[1].event).toMatchObject({ type: 'REPLACE_SETTINGS', data: draft, condition });
  runtime.receive({ to: 'host/settings', answering: messages[1].call, event: { type: 'ASK_FAILED', asked: 'UPDATE_SETTINGS', failure: { kind: 'refused', message: 'refused', problems: ['stale draft'] } } });
  expect(await write).toEqual({ status: 'refused', problems: ['stale draft'] });
  expect(runtime.getSnapshot()!.values.app.personal).toEqual({});
  expect(draft.app.personal.name).toBe('Draft');
  runtime.dispose();
});

it.each([
  undefined, null, {},
  { ...snapshot(), runId: '' },
  { ...snapshot(), revision: -1 },
  { ...snapshot(), revision: 0.5 },
  { ...snapshot(), status: 'saved' },
  { ...snapshot(), catalog: null },
  { ...snapshot(), values: { app: {}, packs: {}, features: {} } },
  { ...snapshot(), values: { app: snapshot().values.app } },
  { ...snapshot(), catalog: { ...snapshot().catalog, dependencies: { owner: [12] } } },
  { ...snapshot(), catalog: { ...snapshot().catalog, features: { 'missing/code': { schema: { type: 'object' }, defaults: {} } } } },
])('rejects an invalid initial snapshot without consuming readiness (case %#)', async initial => {
  const messages: Message[] = [];
  const runtime = createWindowSettingsRuntime({ send: async message => { messages.push(message); } });
  runtime.connected();
  await flush();
  expect(() => runtime.receive({ to: 'host/settings', answering: messages[0].call,
    event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot: initial } } })).not.toThrow();
  expect(runtime.port.status()).toBe('disconnected');
  expect(runtime.getSnapshot()).toBeUndefined();
  expect((await runtime.port.reset(target)).status).toBe('refused');
  runtime.dispose();
});

it('retains the accepted document after an invalid update and accepts the next valid revision', async () => {
  const { runtime } = await windowRuntime();
  const invalid = snapshot('run-one', 1);
  invalid.values.app.projects = [12] as never;
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: invalid } });
  expect(runtime.getSnapshot()?.revision).toBe(0);
  expect(runtime.port.status()).toBe('ready');
  const valid = snapshot('run-one', 1);
  valid.values.app.projects = [{ name: 'Accepted', directories: ['/accepted'], color: '#123456' }];
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: valid } });
  expect(runtime.port.get(target)).toMatchObject({ projects: valid.values.app.projects });
  runtime.dispose();
});

it('refuses declarations or values changed under unchanged revisions', async () => {
  const { runtime } = await windowRuntime();
  const changedCatalog = snapshot('run-one', 1);
  changedCatalog.catalog = { ...changedCatalog.catalog, app: { ...changedCatalog.catalog.app, title: 'Changed' } };
  const changedValues = snapshot();
  changedValues.values.app.personal.name = 'Unversioned';
  for (const next of [changedCatalog, changedValues]) runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: next } });
  expect(runtime.getSnapshot()).toEqual(snapshot());
  runtime.dispose();
});

it('isolates a failed subscriber from other forms and pending request completion', async () => {
  const { runtime, messages } = await windowRuntime();
  runtime.port.subscribe(() => { throw new Error('broken form'); });
  const healthy = vi.fn();
  runtime.port.subscribe(healthy);
  const write = runtime.port.reset(target);
  await flush();
  expect(() => runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: snapshot('run-one', 1) } })).not.toThrow();
  expect(healthy).toHaveBeenCalledOnce();
  runtime.receive({ to: 'host/settings', answering: messages[1].call, event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: runtime.getSnapshot() } } });
  expect(await write).toEqual({ status: 'saved' });
  expect(() => runtime.dispose()).not.toThrow();
});

it('settles malformed refusals and does not expose the wire array to the caller', async () => {
  const { runtime, messages } = await windowRuntime();
  for (const problems of [undefined, 'invalid', [], [12]]) {
    const write = runtime.port.reset(target);
    await flush();
    // A refusal with neither problems nor a message to show in their place
    runtime.receive({ to: 'host/settings', answering: messages.at(-1)!.call, event: { type: 'ASK_FAILED', asked: 'RESET_SETTINGS', failure: { kind: 'refused', problems } } });
    expect(await write).toEqual({ status: 'refused', problems: ['The backend returned an invalid settings refusal.'] });
  }
  const write = runtime.port.reset(target);
  await flush();
  const problems = ['invalid'];
  runtime.receive({ to: 'host/settings', answering: messages.at(-1)!.call, event: { type: 'ASK_FAILED', asked: 'RESET_SETTINGS', failure: { kind: 'refused', message: 'refused', problems } } });
  problems.push('mutated');
  expect(await write).toEqual({ status: 'refused', problems: ['invalid'] });
  runtime.dispose();
});

it('refuses an unserializable write before registering or sending a pending request', async () => {
  const { runtime, messages } = await windowRuntime();
  const write = runtime.port.update(target, ['personal', 'name'], () => {});
  expect(await write).toEqual({ status: 'refused', problems: ['Settings changes must contain ordinary JSON data.'] });
  await flush();
  expect(messages).toHaveLength(1);
  runtime.dispose();
});

it('refuses data that cloning would normalize or drop without invoking accessors', async () => {
  const { runtime, messages } = await windowRuntime();
  const getter = vi.fn(() => 'would be normalized');
  const accessor = Object.defineProperty({}, 'name', { enumerable: true, get: getter });
  const hidden = Object.defineProperty({}, 'name', { value: 'would be dropped' });
  const symbol = { [Symbol('hidden')]: 'would be dropped' };
  class SettingsValue { name = 'would lose its prototype'; }
  for (const value of [accessor, hidden, symbol, new SettingsValue()]) {
    expect((await runtime.port.update(target, ['personal'], value)).status).toBe('refused');
    expect((await runtime.replaceAll(value, { runId: 'run-one', expected: { exists: true, value: {} } })).status).toBe('refused');
  }
  expect(getter).not.toHaveBeenCalled();
  await flush();
  expect(messages).toHaveLength(1);
  runtime.dispose();
});

it('terminates a refused initial read immediately', async () => {
  const messages: Message[] = [];
  const runtime = createWindowSettingsRuntime({ send: async message => { messages.push(message); } });
  runtime.connected();
  await flush();
  runtime.receive({ to: 'host/settings', answering: messages[0].call, event: { type: 'ASK_FAILED', asked: 'GET_SETTINGS', failure: { kind: 'unavailable', message: 'unavailable' } } });
  expect(runtime.port.status()).toBe('disconnected');
  runtime.dispose();
});

it('validates pack and feature values against their own declarations, including missing values', async () => {
  const initial = snapshot();
  const definition = { schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'] }, defaults: { count: 1 } };
  initial.catalog = { ...initial.catalog, packs: { owner: { shared: definition } }, features: { 'owner/code': definition }, dependencies: { owner: [] } };
  initial.values.packs = { owner: { shared: { count: 2 } } };
  initial.values.features = { 'owner/code': { count: 3 } };
  const { runtime } = await windowRuntime(initial);
  const missingGroup = structuredClone(initial);
  delete missingGroup.values.packs.owner.shared;
  const missingFeature = structuredClone(initial);
  delete missingFeature.values.features['owner/code'];
  const invalidGroup = structuredClone(initial);
  invalidGroup.values.packs.owner.shared = { count: 'invalid' };
  const invalidFeature = structuredClone(initial);
  invalidFeature.values.features['owner/code'] = { count: null };
  for (const next of [missingGroup, missingFeature, invalidGroup, invalidFeature]) {
    next.revision = 1;
    runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: next } });
    expect(runtime.getSnapshot()).toEqual(initial);
  }
  runtime.dispose();
});

it('accepts changed defaults with a new catalog revision even without a value write', async () => {
  const initial = snapshot();
  const { runtime } = await windowRuntime(initial);
  const next = snapshot();
  next.catalog = { ...next.catalog, revision: 1, app: { ...next.catalog.app, defaults: { ...next.catalog.app.defaults, personal: { name: 'New default' } } } };
  next.values.app.personal.name = 'New default';
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_UPDATED', snapshot: next } });
  expect(runtime.getSnapshot()).toEqual(next);
  runtime.dispose();
});


it('keeps pack mutation transports and pending requests separate from window administration', async () => {
  const { runtime, messages } = await windowRuntime();
  const firstMessages: Message[] = [];
  const secondMessages: Message[] = [];
  const first = runtime.bindPort('owner', async message => { firstMessages.push(message); });
  const second = runtime.bindPort('owner', async message => { secondMessages.push(message); });
  const firstWrite = first.port.reset(target);
  const secondWrite = second.port.reset(target);
  const hostWrite = runtime.port.reset(target);
  await flush();
  expect(firstMessages).toHaveLength(1);
  expect(secondMessages).toHaveLength(1);
  expect(messages).toHaveLength(2);
  first.dispose();
  expect(await firstWrite).toMatchObject({ status: 'refused' });
  runtime.receive({ to: 'host/settings', answering: secondMessages[0].call, event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: runtime.getSnapshot() } } });
  runtime.receive({ to: 'host/settings', answering: messages[1].call, event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: runtime.getSnapshot() } } });
  expect(await secondWrite).toEqual({ status: 'saved' });
  expect(await hostWrite).toEqual({ status: 'saved' });
  expect(first.port.get(target)).toBeUndefined();
  expect(first.port.status()).toBe('disposed');
  expect(second.port.get(target)).toEqual(runtime.port.get(target));
  expect(() => first.port.subscribe(() => {})).toThrow('unloaded');
  expect((await first.port.reset(target)).status).toBe('refused');
  runtime.dispose();
});

it('revokes a pack before its queued mutation leaves the window', async () => {
  const { runtime } = await windowRuntime();
  const send = vi.fn(async () => {});
  const binding = runtime.bindPort('owner', send);
  const write = binding.port.update(target, ['personal', 'name'], 'Queued');
  binding.dispose();
  expect(await write).toMatchObject({ status: 'refused' });
  await flush();
  expect(send).not.toHaveBeenCalled();
  runtime.dispose();
});

it('disconnect invalidates accepted pack ports permanently and notifies their subscribers', async () => {
  const { runtime, messages } = await windowRuntime();
  const binding = runtime.bindPort('owner', async () => {});
  const observed: unknown[] = [];
  binding.port.subscribe(() => { observed.push(binding.port.get(target)); });
  runtime.disconnected();
  expect(observed).toEqual([undefined]);
  expect(binding.port.status()).toBe('disposed');
  runtime.connected();
  await flush();
  runtime.receive({ to: 'host/settings', answering: messages.at(-1)!.call,
    event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { snapshot: snapshot('run-two') } } });
  expect(runtime.port.status()).toBe('ready');
  expect(binding.port.status()).toBe('disposed');
  expect((await binding.port.reset(target)).status).toBe('refused');
  expect(runtime.bindPort('owner', async () => {}).port.status()).toBe('ready');
  expect(observed).toEqual([undefined]);
  runtime.dispose();
});

it('requires an accepted snapshot before creating pack settings access', () => {
  const runtime = createWindowSettingsRuntime({ send: async () => {} });
  expect(() => runtime.bindPort('owner', async () => {})).toThrow('ready');
  runtime.dispose();
});


it('uses the committed reply snapshot for a sequential write before its broadcast arrives', async () => {
  const { runtime, messages } = await windowRuntime();
  const first = runtime.port.update(target, ['personal', 'name'], 'Ada');
  await flush();
  const committed = snapshot('run-one', 1);
  committed.values.app.personal.name = 'Ada';
  runtime.receive({ to: 'host/settings', answering: messages[1].call,
    event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: committed } } });
  expect(await first).toEqual({ status: 'saved' });
  const second = runtime.port.update(target, ['personal', 'name'], 'Grace');
  await flush();
  expect(messages[2].event).toMatchObject({ condition: { expected: { exists: true, value: 'Ada' } } });
  runtime.dispose();
  await second;
});


it('applies backend dependency read policy to an accepted frontend binding', async () => {
  const initial = snapshot();
  initial.catalog = { ...initial.catalog,
    dependencies: { owner: ['dependency'], dependency: [], unrelated: [] },
    packs: Object.fromEntries(['dependency', 'unrelated'].map(id =>
      [id, { preferences: { schema: { type: 'object' }, defaults: { name: id } } }])),
  };
  for (const id of ['dependency', 'unrelated']) initial.values.packs[id] = { preferences: { name: id } };
  const { runtime } = await windowRuntime(initial);
  const bound = runtime.bindPort('owner', async () => {}).port;
  expect(bound.get({ kind: 'pack', packId: 'dependency', groupId: 'preferences' })).toEqual({ name: 'dependency' });
  expect(() => bound.get({ kind: 'pack', packId: 'unrelated', groupId: 'preferences' })).toThrow('does not depend');
  expect(runtime.port.get({ kind: 'pack', packId: 'unrelated', groupId: 'preferences' })).toEqual({ name: 'unrelated' });
  runtime.dispose();
});

it('refuses a malformed save acknowledgement without discarding accepted window state', async () => {
  const { runtime, messages } = await windowRuntime();
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const write = runtime.port.update(target, ['personal', 'name'], 'Ada');
    await flush();
    runtime.receive({ to: 'host/settings', answering: messages[1].call,
      event: { type: 'ASK_ANSWERED', asked: 'UPDATE_SETTINGS', answer: { snapshot: {} } } });
    expect(await write).toMatchObject({ status: 'refused', problems: [expect.stringContaining('invalid settings save snapshot')] });
    expect(runtime.port.status()).toBe('ready');
    expect(runtime.getSnapshot()).toEqual(snapshot());
  } finally { report.mockRestore(); runtime.dispose(); }
});


it('keeps invalid settings distinct from a broken connection and supports an acknowledged recovery', async () => {
  const messages: Message[] = [];
  const runtime = createWindowSettingsRuntime({ send: async message => { messages.push(message); } });
  runtime.connected();
  await flush();
  const recovery = { version: { runId: 'run-one', revision: 0 }, problems: [{ target, path: ['projects'], message: 'must be array' }] };
  runtime.receive({ to: 'host/settings', answering: messages[0].call, event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { recovery } } });
  expect(runtime.port.status()).toBe('loading'); // Packs never see recovery; only this window's screen does.
  expect(runtime.getSnapshot()).toBeUndefined();
  expect(runtime.port.get(target)).toBeUndefined();
  expect(runtime.getRecovery()).toEqual(recovery);
  expect(() => runtime.bindPort('owner', async () => {})).toThrow('must be ready');
  expect(await runtime.port.reset(target)).toMatchObject({ status: 'refused' });
  const write = runtime.recover({ version: recovery.version, reset: [target] });
  await flush();
  expect(messages[1].event).toEqual({ type: 'RECOVER_SETTINGS', request: { version: recovery.version, reset: [target] } });
  const settled = vi.fn();
  void write.then(settled);
  const repaired = { version: { ...recovery.version, revision: 1 }, problems: [] };
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_RECOVERY', recovery: repaired } });
  await flush();
  expect(settled).not.toHaveBeenCalled(); // A broadcast can precede this request's own answer.
  runtime.receive({ to: 'host/settings', answering: messages[1].call, event: { type: 'ASK_ANSWERED', asked: 'RECOVER_SETTINGS', answer: { recovery: repaired } } });
  expect(await write).toEqual({ status: 'saved' });
  expect(runtime.getSnapshot()).toBeUndefined();
  expect(runtime.getRecovery()).toEqual(repaired); // Relaunch still owns normal startup.
  runtime.dispose();
});

it('follows another window repairing settings, and ignores stale diagnostics', async () => {
  const { runtime } = await windowRuntime();
  const recovery = { version: { runId: 'run-one', revision: 1 }, problems: [{ path: [], message: 'Broken document' }] };
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_RECOVERY', recovery } });
  expect(runtime.getSnapshot()).toBeUndefined();
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_RECOVERY', recovery: { version: { runId: 'run-one', revision: 2 }, problems: [] } } });
  expect(runtime.getRecovery()?.problems).toEqual([]);
  runtime.receive({ to: 'host/settings', event: { type: 'SETTINGS_RECOVERY', recovery } });
  expect(runtime.getRecovery()?.problems).toEqual([]);
  runtime.disconnected();
  expect(runtime.getRecovery()).toBeUndefined();
  runtime.dispose();
});

it('refuses malformed recovery responses as protocol failures rather than displaying their contents', async () => {
  const messages: Message[] = [];
  const runtime = createWindowSettingsRuntime({ send: async message => { messages.push(message); } });
  runtime.connected();
  await flush();
  runtime.receive({ to: 'host/settings', answering: messages[0].call, event: { type: 'ASK_ANSWERED', asked: 'GET_SETTINGS', answer: { recovery: { problems: [] } } } });
  expect(runtime.port.status()).toBe('disconnected');
  expect(runtime.getRecovery()).toBeUndefined();
  runtime.dispose();
});
