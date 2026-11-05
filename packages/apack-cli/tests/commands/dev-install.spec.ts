import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const installPackFromLocal = vi.fn(async () => ({ dir: '/installed', missingDependencies: [] }));
vi.mock('@apackdev/host/packs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apackdev/host/packs')>()),
  installPackFromLocal,
}));

let userDataDir: string;
vi.mock('@apackdev/sdk/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apackdev/sdk/env')>()),
  resolveAppEnvironment: () => ({
    env: 'development', userDataDir, packsDir: path.join(userDataDir, 'packs'), installedPacksFile: path.join(userDataDir, 'installed-packs.json'),
    apiPortFile: path.join(userDataDir, 'api-port'), apiTokenFile: path.join(userDataDir, 'api-token'),
  }),
}));

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-install-'));
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
  /** A stand-in for the dev app's API, recording each reload request */
  async function fakeApi(status: number): Promise<{ port: number; requests: Array<{ url?: string; token?: string | string[]; body: string }>; close: () => void }> {
    const requests: Array<{ url?: string; token?: string | string[]; body: string }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ url: req.url, token: req.headers['x-apack-api-token'], body });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as { port: number }).port, requests, close: () => server.close() };
  }

  it("send the pack id with the token from the dev app's token file", async () => {
    const { API_TOKEN_HEADER } = await import('@apackdev/sdk/utils/pure');
    expect(API_TOKEN_HEADER).toBe('x-apack-api-token');
    const api = await fakeApi(200);
    try {
      fs.writeFileSync(path.join(userDataDir, 'api-port'), JSON.stringify({ port: api.port, pid: process.pid }));
      fs.writeFileSync(path.join(userDataDir, 'api-token'), 'the-dev-token\n');
      const { reloadPack } = await import('../../src/app/app-api.ts');

      expect(await reloadPack('my-pack')).toEqual({ status: 'delivered' });
      expect(api.requests).toEqual([{ url: '/dev/reload', token: 'the-dev-token', body: JSON.stringify({ packId: 'my-pack' }) }]);
    } finally {
      api.close();
    }
  });

  it('ask the app to install the build at the pack\'s absolute root, which the app copies and starts itself', async () => {
    const api = await fakeApi(200);
    try {
      fs.writeFileSync(path.join(userDataDir, 'api-port'), JSON.stringify({ port: api.port, pid: process.pid }));
      fs.writeFileSync(path.join(userDataDir, 'api-token'), 'the-dev-token');
      const { installPackInApp } = await import('../../src/app/app-api.ts');

      expect(await installPackInApp('relative/pack')).toEqual({ status: 'delivered' });
      expect(api.requests).toEqual([{ url: '/dev/install', token: 'the-dev-token', body: JSON.stringify({ root: path.resolve('relative/pack') }) }]);
    } finally {
      api.close();
    }
  });

  // Each of these needs something different of the author — start the app, read its logs, look at what
  // holds the port — so the status alone was not enough to act on
  it('report a refused reload, a missing port or token file, and an app that no longer answers, and say which', async () => {
    const { reloadPack } = await import('../../src/app/app-api.ts');
    expect(await reloadPack('my-pack')).toMatchObject({ status: 'not-running', detail: expect.stringContaining('api-port') });

    const api = await fakeApi(403);
    fs.writeFileSync(path.join(userDataDir, 'api-port'), JSON.stringify({ port: api.port, pid: process.pid }));
    expect(await reloadPack('my-pack'), 'no token file')
      .toMatchObject({ status: 'not-running', detail: expect.stringContaining('api-token') });
    fs.writeFileSync(path.join(userDataDir, 'api-token'), '\n');
    expect(await reloadPack('my-pack'), 'an empty token file')
      .toMatchObject({ status: 'not-running', detail: expect.stringContaining('is empty') });
    fs.writeFileSync(path.join(userDataDir, 'api-token'), 'the-dev-token');
    try {
      expect(await reloadPack('my-pack')).toMatchObject({ status: 'failed', detail: expect.stringContaining('403') });
    } finally {
      api.close();
    }
    expect(await reloadPack('my-pack')).toMatchObject({ status: 'unreachable', detail: expect.stringContaining(`127.0.0.1:${api.port}`) });
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
