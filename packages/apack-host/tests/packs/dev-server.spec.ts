import { sealBuild } from './runtime/build-fixture.ts';
// `apack pack dev` state lives in the data dir, outside the installed (verified, replaced-on-install) pack
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAppEnvironment } from '@apackdev/sdk/env';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { verifyPack } from '../../src/packs/layout.ts';
import { installPackFromLocal } from '../../src/packs/installer.ts';
import {
  devServerMarkerPath,
  devServerUrl,
  removeDevServerMarker,
  writeDevServerMarker,
} from '../../src/packs/dev-server.ts';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';

let tmp: string;
let userDataDir: string;
let packsDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-server-spec-'));
  ({ userDataDir, packsDir } = resolveAppEnvironment({ env: 'test', userDataDir: path.join(tmp, 'data') }));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A pack source dir as `apack pack build` leaves it. */
function builtPack(): string {
  const root = path.join(tmp, 'src-pack');
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('apack.json', JSON.stringify({ id: 'demo-pack', name: 'Demo Pack', version: '1.2.3' }));
  write('dist/runtime/index.cjs', 'module.exports = { registration: { id: "demo-pack" } };');
  write('dist/runtime/fe.js', 'export default {};');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf8'));
  write('dist/types/snapshot.json', JSON.stringify({ format: PACK_SNAPSHOT_FORMAT, manifest, declarationRevision: _declarationRevision(manifest), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  sealBuild(root);
  return root;
}

describe('dev server marker', () => {
  it('lives in the data dir, outside the packs dir', () => {
    const file = writeDevServerMarker(userDataDir, 'demo-pack', { port: 5199, pid: 42 });
    expect(file).toBe(devServerMarkerPath(userDataDir, 'demo-pack'));
    expect(path.relative(packsDir, file).startsWith('..')).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ port: 5199, pid: 42 });
  });

  it("gives the pack:// handler the dev server URL while the marker exists", () => {
    expect(devServerUrl(userDataDir, 'demo-pack', '/runtime/fe.js')).toBeNull();
    writeDevServerMarker(userDataDir, 'demo-pack', { port: 5200, pid: process.pid });
    expect(devServerUrl(userDataDir, 'demo-pack', '/runtime/fe.js')).toBe('http://localhost:5200/runtime/fe.js');
    expect(devServerUrl(userDataDir, 'other-pack', '/runtime/fe.js')).toBeNull();
    removeDevServerMarker(userDataDir, 'demo-pack');
    expect(devServerUrl(userDataDir, 'demo-pack', '/runtime/fe.js')).toBeNull();
  });

  it('rejects a marker without a valid port', () => {
    fs.mkdirSync(path.dirname(devServerMarkerPath(userDataDir, 'demo-pack')), { recursive: true });
    fs.writeFileSync(devServerMarkerPath(userDataDir, 'demo-pack'), JSON.stringify({ port: 70000 }));
    expect(() => devServerUrl(userDataDir, 'demo-pack', '/runtime/fe.js')).toThrow(/port 70000/);
  });

  it('leaves an installed pack verifiable, and survives the reinstalls apack pack dev runs', async () => {
    const { dir } = await installPackFromLocal(builtPack(), packsDir);
    writeDevServerMarker(userDataDir, 'demo-pack', { port: 5199, pid: process.pid });

    expect(verifyPack(dir).id).toBe('demo-pack');

    await installPackFromLocal(builtPack(), packsDir);
    expect(verifyPack(dir).id).toBe('demo-pack');
    expect(devServerUrl(userDataDir, 'demo-pack', '/runtime/fe.js')).toBe('http://localhost:5199/runtime/fe.js');
  });
});

// The marker is removed on the way out, so one still here after `apack pack dev` crashed names a port nothing
// is listening on. Serving the pack's frontend from it fails with a connection error and nothing saying
// this file is why; falling back to the installed copy at least shows the pack.
describe('a dev server that is no longer running', () => {
  /** A pid no process has any more */
  const exitedPid = async () => {
    const exited = execFileWhileWorking(process.execPath, ['-e', '']);
    await exited;
    return exited.child.pid!;
  };

  it('is not served from, while a live one still is', async () => {
    writeDevServerMarker(userDataDir, 'demo-pack', { port: 5199, pid: process.pid });
    expect(devServerUrl(userDataDir, 'demo-pack', '/fe.js')).toBe('http://localhost:5199/fe.js');

    writeDevServerMarker(userDataDir, 'demo-pack', { port: 5199, pid: await exitedPid() });
    expect(devServerUrl(userDataDir, 'demo-pack', '/fe.js')).toBeNull();
  });

  it('refuses a marker with no pid to check, rather than trusting its port', () => {
    fs.mkdirSync(path.dirname(devServerMarkerPath(userDataDir, 'demo-pack')), { recursive: true });
    fs.writeFileSync(devServerMarkerPath(userDataDir, 'demo-pack'), JSON.stringify({ port: 5199 }));

    expect(() => devServerUrl(userDataDir, 'demo-pack', '/fe.js')).toThrow(/pid undefined/);
  });
});
