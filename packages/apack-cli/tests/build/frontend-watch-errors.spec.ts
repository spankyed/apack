import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFrontendWatcher } from '../../src/build/frontend-watch.ts';

type FakeWatcher = EventEmitter & { close: ReturnType<typeof vi.fn> };
const state = vi.hoisted(() => ({ resources: [] as FakeWatcher[], guards: [] as Array<{ directory: string; watcher: FakeWatcher }>, ready: true }));
vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs')>();
  const { EventEmitter } = await import('node:events');
  const watch = vi.fn((directory: string) => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
    state.guards.push({ directory, watcher });
    return watcher;
  });
  return { ...original, watch, default: { ...original, watch } };
});
vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events');
  return { watch: vi.fn(() => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn(async () => {}) });
    state.resources.push(watcher);
    if (state.ready) queueMicrotask(() => watcher.emit('ready'));
    return watcher;
  }) };
});

let temporary: string;
beforeEach(() => {
  state.resources = []; state.guards = []; state.ready = true;
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-frontend-watch-errors-'));
});
afterEach(() => { fs.rmSync(temporary, { recursive: true, force: true }); });

function fixture(resubscribed?: () => void) {
  const root = path.join(temporary, 'pack');
  fs.mkdirSync(root);
  const file = path.join(temporary, 'style.css');
  fs.writeFileSync(file, 'STYLE');
  const failed = vi.fn();
  const changed = vi.fn();
  const watcher = createFrontendWatcher(root, undefined, changed, failed, [], resubscribed);
  return { watcher, failed, changed, inputs: { files: [file], directories: [], successful: true } };
}

it.each(['resource', 'guard'] as const)('attributes and retires a failed frontend %s subscription', async kind => {
  const { watcher, failed, changed, inputs } = fixture();
  try {
    await watcher.observe(inputs);
    const emitter = kind === 'resource' ? state.resources[0]! : state.guards[0]!.watcher;
    const failure = Object.assign(new Error('watch limit'), { code: 'EMFILE' });
    expect(() => emitter.emit('error', failure)).not.toThrow();
    await watcher.close();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ cause: failure }));
    for (const entry of [...state.resources, ...state.guards.map(guard => guard.watcher)]) expect(entry.close).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    await expect(watcher.observe(inputs)).rejects.toMatchObject({ cause: failure });
    await expect(watcher.accept(inputs)).rejects.toMatchObject({ cause: failure });
  } finally { await watcher.close(); }
});

it('refuses readiness when a resource watcher fails before ready', async () => {
  state.ready = false;
  const { watcher, failed, inputs } = fixture();
  const failure = new Error('watch could not start');
  const observing = expect(watcher.observe(inputs)).rejects.toMatchObject({ cause: failure });
  state.resources[0]!.emit('error', failure);
  await observing;
  await watcher.close();
  expect(failed).toHaveBeenCalledTimes(1);
  for (const entry of [...state.resources, ...state.guards.map(guard => guard.watcher)]) expect(entry.close).toHaveBeenCalledTimes(1);
});

it('ignores errors from replaced subscriptions', async () => {
  const { watcher, failed, inputs } = fixture();
  try {
    await watcher.observe(inputs);
    const retired = state.resources[0]!;
    await watcher.accept({ ...inputs, files: [] });
    expect(retired.close).toHaveBeenCalledTimes(1);
    expect(() => retired.emit('error', new Error('retired'))).not.toThrow();
    expect(failed).not.toHaveBeenCalled();
  } finally { await watcher.close(); }
});

it('waits for disposal already in progress during subscription replacement', async () => {
  const { watcher, inputs } = fixture();
  await watcher.observe(inputs);
  let begin!: () => void, finish!: () => void;
  const retiring = new Promise<void>(resolve => { begin = resolve; });
  const retired = new Promise<void>(resolve => { finish = resolve; });
  state.resources[0]!.close.mockImplementationOnce(() => { begin(); return retired; });
  const replacing = watcher.accept({ ...inputs, files: [] });
  await retiring;
  let closed = false;
  const closing = watcher.close().then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  finish();
  await Promise.all([replacing, closing]);
  for (const entry of [...state.resources, ...state.guards.map(guard => guard.watcher)]) expect(entry.close).toHaveBeenCalledTimes(1);
});

it('holds its watches open and reports nothing when the inputs did not move', async () => {
  const resubscribed = vi.fn();
  const { watcher, inputs } = fixture(resubscribed);
  try {
    await watcher.observe(inputs);
    expect(resubscribed).toHaveBeenCalledTimes(1);
    const watches = [...state.resources, ...state.guards.map(guard => guard.watcher)];
    expect(state.guards.length).toBeGreaterThan(0);
    await watcher.accept(inputs);
    await watcher.observe(inputs);
    expect([...state.resources, ...state.guards.map(guard => guard.watcher)]).toEqual(watches);
    for (const entry of watches) expect(entry.close).not.toHaveBeenCalled();
    expect(resubscribed).toHaveBeenCalledTimes(1);
  } finally { await watcher.close(); }
});

it('reports a change to the watches it holds', async () => {
  const resubscribed = vi.fn();
  const { watcher, inputs } = fixture(resubscribed);
  try {
    await watcher.observe(inputs);
    await watcher.accept({ ...inputs, files: [] });
    expect(resubscribed).toHaveBeenCalledTimes(2);
  } finally { await watcher.close(); }
});
