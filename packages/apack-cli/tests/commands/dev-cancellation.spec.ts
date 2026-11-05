import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', stage: 'build' as 'build' | 'watch' | 'ready', aborted: false, finish: () => {}, fail: (_error: Error) => {},
  install: { status: 'delivered' } as { status: string; detail?: string } }));

function pending(signal: AbortSignal): Promise<never> {
  const resource = path.join(state.root, 'compiler');
  fs.writeFileSync(resource, 'owned compiler');
  signal.addEventListener('abort', () => { state.aborted = true; }, { once: true });
  return new Promise((_, reject) => {
    state.finish = () => {
      fs.rmSync(resource);
      reject(new DOMException('Build stopped', 'AbortError'));
    };
  });
}

vi.mock('../../src/build/build-process.ts', () => ({
  createPackBuilder: () => ({
    build: vi.fn(({ signal }: { signal: AbortSignal }) => state.stage === 'build' ? pending(signal) : Promise.resolve()),
    serveFrontend: async () => undefined,
    close: async () => {},
  }),
}));
vi.mock('../../src/build/watch.ts', () => ({
  startPackBuildWatcher: vi.fn((_root: string, { signal }: { signal: AbortSignal }) => {
    if (state.stage !== 'ready') return pending(signal);
    const file = path.join(state.root, 'watcher');
    fs.writeFileSync(file, 'owned watcher');
    const done = new Promise<void>((_resolve, reject) => { state.fail = reject; });
    return Promise.resolve({ done, close: async () => { fs.rmSync(file, { force: true }); } });
  }),
}));
vi.mock('../../src/app/pack-host', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/app/pack-host')>(),
  cliDirs: () => ({ cache: path.join(state.root, 'cache'), data: path.join(state.root, 'data') }),
  resolvePackHost: () => ({ kind: 'source', root: state.root }),
  setHostHandoff: () => {},
}));
vi.mock('../../src/app/profiles', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/app/profiles')>(),
  profileFor: () => {
    const dir = path.join(state.root, 'profile');
    fs.mkdirSync(dir);
    return { name: 'cancel-test', dir, ephemeral: true };
  },
  removeProfile: (_dirs: unknown, directory: string) => fs.rmSync(directory, { recursive: true }),
}));
vi.mock('@apackdev/host/process-liveness', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/process-liveness')>(),
  readApiEndpoint: () => ({ port: 1234, pid: process.pid }),
}));
vi.mock('@apackdev/host/dev-session', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/dev-session')>(),
  readSession: () => ({ startedBy: 'dev' }),
}));
vi.mock('../../src/app/drive-attach', () => ({ verifySessionHost: () => {} }));
vi.mock('../../src/app/app-api.ts', () => ({ installPackInApp: async () => state.install }));

import { dev } from '../../src/commands/dev';

let terminate: () => void;
beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dev-cancellation-'));
  state.aborted = false;
  state.install = { status: 'delivered' };
  fs.writeFileSync(path.join(state.root, 'apack.json'), JSON.stringify({ id: 'cancel-test', name: 'Cancel test', version: '1.0.0', features: {} }));
  vi.spyOn(process, 'cwd').mockReturnValue(state.root);
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const on = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'SIGTERM') { terminate = listener; return process; }
    if (event === 'SIGINT' || event === 'exit') return process;
    return on(event, listener);
  });
  vi.stubEnv('APACK_HOST', undefined);
  vi.stubEnv('APACK_HOST_EXECUTABLE', undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(state.root, { recursive: true, force: true });
});

it.each(['build', 'watch'] as const)('drains %s startup before removing its profile or exiting', async stage => {
  state.stage = stage;
  const stopped = expect(dev(['--fresh'])).rejects.toMatchObject({ name: 'AbortError' });
  const resource = path.join(state.root, 'compiler'), profile = path.join(state.root, 'profile');
  await vi.waitFor(() => expect(fs.existsSync(resource)).toBe(true));
  terminate();
  await vi.waitFor(() => expect(state.aborted).toBe(true));
  // Give shutdown a complete event-loop turn while the compiler cleanup remains held.
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(process.exit).not.toHaveBeenCalled();
  expect(fs.existsSync(resource)).toBe(true);
  expect(fs.existsSync(profile)).toBe(true);
  state.finish();
  await stopped;
  await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
  expect(fs.existsSync(resource)).toBe(false);
  expect(fs.existsSync(profile)).toBe(false);
});

it('drains a failed running watcher before removing its dev profile', async () => {
  state.stage = 'ready';
  const failure = new Error('watch limit');
  const watching = expect(dev(['--fresh'])).rejects.toBe(failure);
  const resource = path.join(state.root, 'watcher');
  await vi.waitFor(() => expect(fs.existsSync(resource)).toBe(true));
  state.fail(failure);
  await watching;
  expect(fs.existsSync(resource)).toBe(false);
  expect(fs.existsSync(path.join(state.root, 'profile'))).toBe(false);
});

it('keeps watching after the app refuses the first install, so the author can fix it and save', async () => {
  state.stage = 'ready';
  state.install = { status: 'failed', detail: '500 Internal Server Error: Failed to load pack cancel-test' };
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failure = new Error('stop watching');
  const watching = expect(dev(['--fresh'])).rejects.toBe(failure);
  await vi.waitFor(() => expect(fs.existsSync(path.join(state.root, 'watcher'))).toBe(true));
  expect(warn.mock.calls.flat().join(' ')).toContain('Failed to load pack cancel-test');
  state.fail(failure);
  await watching;
});
