import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { readPackBuild } from '@apackdev/host/packs';
import * as checkout from '../../src/build/checkout-packages.ts';
import * as compiler from '../../src/build/compiler-installation.ts';
import { runPackBuild } from '../../src/build/build-process.ts';
import { BUILD_INPUTS_IPC_ENV } from '../../src/build/build-watch-inputs.ts';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('../../src/app/pack-host', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/app/pack-host')>(),
  cliDirs: () => ({ cache: path.join(fixture.root, 'cache'), data: path.join(fixture.root, 'data') }),
  resolvePackHost: () => ({ kind: 'packaged', executable: path.join(fixture.root, 'apack Beta.app/Contents/MacOS/apack Beta'), version: '0.4.0' }),
}));
vi.mock('@apackdev/host/process-liveness', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/host/process-liveness')>(),
  readApiEndpoint: () => ({ port: 1234, pid: process.pid }),
}));
vi.mock('../../src/commands/build', () => ({
  build: vi.fn(() => { throw new Error('Supervisor retained its old compiler'); }),
}));
import { build } from '../../src/commands/build';
import { dev } from '../../src/commands/dev';
import { _settles } from '@apackdev/sdk/testing/waiting';


it('builds with a fresh compiler before attempting to reuse the host', async () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dev-build-'));
  const root = path.join(fixture.root, 'pack');
  const exitListeners = new Set(process.listeners('exit'));
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const listeners = signals.map(event => ({ event, before: new Set(process.listeners(event)) }));
  try {
    packFixture({ at: root, nodeModules: path.join(REPO_ROOT, 'node_modules'),
      manifest: { id: 'fresh-dev-build', name: 'Fresh dev build', features: {} }, files: {} });
    const resources = path.join(fixture.root, 'apack Beta.app/Contents/Resources/app');
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, 'build-manifest.json'), JSON.stringify({ channel: 'beta' }));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubEnv('APACK_HOST', undefined);
    // The simulated occupied packaged host refuses reuse; no Electron process is launched.
    await expect(dev(['--profile', 'owned'])).rejects.toThrow('cannot verify the app');
    expect(build).not.toHaveBeenCalled();
    expect(readPackBuild(path.join(root, 'dist')).revision).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    for (const listener of process.listeners('exit')) {
      if (!exitListeners.has(listener)) process.removeListener('exit', listener);
    }
    for (const { event, before } of listeners) {
      for (const listener of process.listeners(event)) if (!before.has(listener)) process.removeListener(event, listener);
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

it('cancels its build child and disables inherited input reporting without an observer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dev-cancel-'));
  const ready = path.join(root, 'ready.json');
  const script = path.join(root, 'bin/waiting.mjs');
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  try {
    packFixture({ at: root, manifest: { id: 'cancel-build', name: 'Cancel build', features: {} }, files: {} });
    fs.mkdirSync(path.join(root, 'bin'));
    fs.mkdirSync(path.join(root, 'dist'));
    // This fake compiler exercises parent cancellation; real bootstrap admission has its own checks.
    fs.writeFileSync(path.join(root, 'dist/compiler-startup.cjs'), '');
    fs.writeFileSync(script, `import fs from 'node:fs'; process.on('message', () => {}); fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, reporting: process.env.${BUILD_INPUTS_IPC_ENV}, cacheDisabled: process.env.TSX_DISABLE_CACHE }));`);
    const dispose = vi.fn(async () => {
      const { pid } = JSON.parse(fs.readFileSync(ready, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    });
    vi.spyOn(compiler, 'captureCompilerInstallation').mockResolvedValue({ executable: process.execPath, runtimeDirectory: path.dirname(process.execPath), bin: script, hash: '0'.repeat(64), inputsFile: path.join(root, 'compiler-inputs.json'), environment: { ESBUILD_BINARY_PATH: undefined }, isCurrent: () => true, dispose });
    vi.spyOn(checkout, 'ensureCheckoutPackages').mockImplementation(() => {});
    vi.stubEnv(BUILD_INPUTS_IPC_ENV, '1');
    running = runPackBuild(root, { signal: controller.signal });
    void running.catch(() => {});
    await _settles(() => expect(fs.existsSync(ready)).toBe(true));
    const { pid, reporting, cacheDisabled } = JSON.parse(fs.readFileSync(ready, 'utf8'));
    expect(reporting).toBe('0');
    expect(cacheDisabled).toBe('1');
    const stopped = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await stopped;
    expect(dispose).toHaveBeenCalledOnce();
    await _settles(() => expect(() => process.kill(pid, 0)).toThrow());
  } finally {
    controller.abort();
    await running?.catch(() => {});
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
