import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root: string;
vi.mock('../../src/app/pack-host', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/app/pack-host')>(),
  cliDirs: () => ({ cache: path.join(root, 'cache'), data: path.join(root, 'data') }),
  resolvePackHost: () => ({ kind: 'packaged', executable: path.join(root, 'apack Beta.app/Contents/MacOS/apack Beta'), version: '0.4.0' }),
}));
const { build } = vi.hoisted(() => ({ build: vi.fn(async () => {}) }));
vi.mock('../../src/build/build-process.ts', () => ({ createPackBuilder: () => ({ build, close: async () => {} }) }));
vi.mock('@apackdev/host/transport/tool-client', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/transport/tool-client')>(),
  readApiRuntime: () => ({ pid: process.pid }),
}));
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn,
}));
import { dev } from '../../src/commands/dev';

const signals = ['SIGINT', 'SIGTERM'] as const;
let exitListeners: NodeJS.ExitListener[];
let listeners: { event: NodeJS.Signals; before: NodeJS.SignalsListener[] }[];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dev-owner-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ id: 'test', hostVersion: '*', features: [] }));
  const resources = path.join(root, 'apack Beta.app/Contents/Resources/app');
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, 'build-manifest.json'), JSON.stringify({ channel: 'beta' }));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  for (const key of ['APACK_HOST', 'APACK_HOST_ROOT', 'APACK_HOST_EXECUTABLE', 'APACK_APP', 'APACK_CHANNEL', 'APACK_BUILD']) vi.stubEnv(key, undefined);
  exitListeners = process.listeners('exit');
  listeners = signals.map(event => ({ event, before: process.listeners(event) }));
});
afterEach(() => {
  for (const listener of process.listeners('exit')) {
    if (!exitListeners.includes(listener)) process.removeListener('exit', listener);
  }
  for (const { event, before } of listeners) {
    for (const listener of process.listeners(event)) {
      if (!before.includes(listener)) process.removeListener(event, listener);
    }
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it('refuses to reuse an unverified running app on a packaged host profile', async () => {
  await expect(dev(['--profile', 'owned'])).rejects.toThrow('cannot verify the app');
  expect(build).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  expect(spawn).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, 'data/profiles/owned'))).toBe(true);
});
