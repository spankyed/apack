import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlRpcError, createControlServer, muxTransport } from '@apackdev/host/transport/mux';
import type { HostControlContract } from '@apackdev/host/transport/control-contract';
import { toolSocketTransport } from '@apackdev/host/transport/tool-client';
import {
  startToolSocketServer,
  writeApiRuntimeFile,
  type ToolSocketServer,
} from '@apackdev/host/transport/tool-socket';

const installPackFromLocal = vi.fn(async () => ({ dir: '/installed', missingDependencies: [] }));
vi.mock('@apackdev/host/packs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apackdev/host/packs')>()),
  installPackFromLocal,
}));

let userDataDir: string;
let appDir: string;
vi.mock('@apackdev/sdk/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apackdev/sdk/env')>()),
  resolveAppEnvironment: () => ({
    env: 'development',
    userDataDir,
    appDir,
    packsDir: path.join(userDataDir, 'packs'),
    installedPacksFile: path.join(userDataDir, 'installed-packs.json'),
  }),
}));

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-install-'));
  appDir = path.join(userDataDir, 'apack');
  fs.mkdirSync(appDir, { recursive: true });
  installPackFromLocal.mockClear();
});
afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('apack pack dev', () => {
  it("installs with the version and pack format of the dev app that last used the data dir, so both are checked", async () => {
    const { recordHostCompatibility } = await import('@apackdev/host/packs');
    recordHostCompatibility(userDataDir, { version: '0.9.1', packFormat: 3 });
    const { installToApp } = await import('../../src/commands/dev');

    await installToApp('/pack');

    expect(installPackFromLocal).toHaveBeenCalledWith('/pack', path.join(userDataDir, 'packs'), expect.objectContaining({ hostVersion: '0.9.1', packFormat: 3, installedPacksFile: path.join(userDataDir, 'installed-packs.json'), accept: expect.any(Function) }));
  });

  it('reads the version at each install, as the dev app may start in between', async () => {
    const { recordHostCompatibility } = await import('@apackdev/host/packs');
    const { installToApp } = await import('../../src/commands/dev');
    await installToApp('/pack');
    recordHostCompatibility(userDataDir, { version: '1.0.0', packFormat: 1 });
    await installToApp('/pack');

    expect(installPackFromLocal.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      expect.objectContaining({ hostVersion: undefined, packFormat: undefined, installedPacksFile: path.join(userDataDir, 'installed-packs.json') }),
      expect.objectContaining({ hostVersion: '1.0.0', packFormat: 1, installedPacksFile: path.join(userDataDir, 'installed-packs.json') }),
    ]);
  });
});

describe('apack pack dev reloads', () => {
  const activeServers: ToolSocketServer[] = [];

  afterEach(async () => {
    for (const server of activeServers.splice(0)) {
      await server.close();
    }
  });

  /** A stand-in for the dev app's tool socket + Control RPC server, recording each dev call. */
  async function fakeToolApi(options: {
    token?: string;
    refuseReload?: ControlRpcError;
  } = {}): Promise<{
    server: ToolSocketServer;
    calls: Array<{ method: 'dev.reload' | 'dev.install'; input: unknown }>;
  }> {
    const calls: Array<{ method: 'dev.reload' | 'dev.install'; input: unknown }> = [];
    const server = await startToolSocketServer({
      appDir,
      token: options.token ?? 'the-dev-token',
      onConnection: (socket, initialBytes) => {
        const mux = muxTransport(toolSocketTransport(socket, initialBytes));
        createControlServer<{
          readonly requests: Pick<HostControlContract['requests'], 'dev.reload' | 'dev.install'>;
        }>(mux.control, {
          requests: {
            'dev.reload': (input) => {
              calls.push({ method: 'dev.reload', input });
              if (options.refuseReload) throw options.refuseReload;
              return { ok: true };
            },
            'dev.install': (input) => {
              calls.push({ method: 'dev.install', input });
              return { ok: true };
            },
          },
        });
      },
    });
    activeServers.push(server);
    return { server, calls };
  }

  it('sends dev.reload over the authenticated local tool socket discovered via api-runtime.json', async () => {
    const api = await fakeToolApi();
    const { reloadPack } = await import('../../src/app/app-api.ts');

    expect(await reloadPack('my-pack')).toEqual({ status: 'delivered' });
    expect(api.calls).toEqual([{ method: 'dev.reload', input: { packId: 'my-pack' } }]);
  });

  it("asks the app to install the build at the pack's absolute root over Control RPC", async () => {
    const api = await fakeToolApi();
    const { installPackInApp } = await import('../../src/app/app-api.ts');

    expect(await installPackInApp('relative/pack')).toEqual({ status: 'delivered' });
    expect(api.calls).toEqual([{ method: 'dev.install', input: { root: path.resolve('relative/pack') } }]);
  });

  it('reports a missing runtime file, pid-only runtime, refused RPC, and an unreachable socket cleanly', async () => {
    const { reloadPack } = await import('../../src/app/app-api.ts');

    expect(await reloadPack('my-pack')).toMatchObject({
      status: 'not-running',
      detail: expect.stringContaining('api-runtime.json'),
    });

    // Production/beta pid-only runtime exposes no local tool socket
    writeApiRuntimeFile(appDir, { pid: process.pid });
    expect(await reloadPack('my-pack'), 'pid-only runtime').toMatchObject({
      status: 'not-running',
      detail: expect.stringContaining('no local tool socket'),
    });

    // Refused Control RPC (e.g. FORBIDDEN / CONFLICT)
    const api = await fakeToolApi({
      refuseReload: new ControlRpcError('CONFLICT', 'another operation on this pack is in progress'),
    });
    const socketPath = api.server.address;
    expect(await reloadPack('my-pack')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('CONFLICT'),
    });

    // Socket closes, but api-runtime.json still points at the dead socket -> unreachable
    await api.server.close();
    writeApiRuntimeFile(appDir, { pid: process.pid, socket: socketPath, token: 'the-dev-token' });
    expect(await reloadPack('my-pack')).toMatchObject({
      status: 'unreachable',
      detail: expect.stringContaining(socketPath),
    });
  });
});

describe('what restarts a packaged app', () => {
  /** A completed build's receipt, as `apack pack build` seals it */
  function writeReceipt(root: string, files: Record<string, string>) {
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'integrity.json'), JSON.stringify({ files }));
  }

  it('is a change to what its backend loads, not to the frontend Vite serves', async () => {
    const { backendRevision } = await import('../../src/commands/dev');
    const root = path.join(userDataDir, 'pack');
    const build = { 'apack.json': 'm1', 'runtime/index.cjs': 'b1', 'runtime/content/notes.content.json': 'c1', 'runtime/fe.js': 'f1', 'runtime/canvas-x.js': 'k1' };
    writeReceipt(root, build);
    const first = backendRevision(root);

    writeReceipt(root, { ...build, 'runtime/fe.js': 'f2', 'runtime/canvas-y.js': 'k2', 'build-inputs.json': 'i2' });
    expect(backendRevision(root), 'a frontend-only rebuild').toBe(first);
    writeReceipt(root, { ...build, 'runtime/index.cjs': 'b2' });
    expect(backendRevision(root), 'a backend rebuild').not.toBe(first);
    writeReceipt(root, { ...build, 'runtime/content/notes.content.json': 'c2' });
    expect(backendRevision(root), 'a content rebuild').not.toBe(first);
  });
});

describe('the environment apack pack dev targets', () => {
  it('reads the bundle channel even when a beta tag carries a production app', async () => {
    const { hostEnvironment, developmentHostEnv } = await import('../../src/commands/dev');
    expect(hostEnvironment({ kind: 'source', root: '/repo' })).toBe('development');
    const resources = path.join(userDataDir, 'apack.app', 'Contents', 'Resources', 'app');
    fs.mkdirSync(resources, { recursive: true });
    const executable = path.join(userDataDir, 'apack.app', 'Contents', 'MacOS', 'apack');
    for (const channel of ['production', 'beta', 'preview']) {
      fs.writeFileSync(path.join(resources, 'build-manifest.json'), JSON.stringify({ channel }));
      const app = { kind: 'packaged', executable, version: '0.4.0-beta.1' } as const;
      expect(hostEnvironment(app)).toBe(channel);
      if (channel === 'production') expect(() => developmentHostEnv(app, true)).toThrow('This bundle is production');
      else {
        expect(() => developmentHostEnv(app, false)).toThrow('requires --profile');
        expect(developmentHostEnv(app, true)).toBe(channel);
      }
    }
    fs.writeFileSync(path.join(resources, 'build-manifest.json'), '{"channel":"development"}');
    expect(() => hostEnvironment({ kind: 'packaged', executable, version: '0.4.0' })).toThrow('Invalid packaged channel');
  });
});
