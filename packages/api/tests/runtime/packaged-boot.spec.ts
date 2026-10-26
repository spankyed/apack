import { _declarationRevision } from '@apackdev/sdk/build';
// The app's boot, over the real packs it ships: each one installed into the data dir and then loaded from
// there, which is the one path for every pack (`npm run build:default-setup` writes the build it is installed from). A
// packaged app's api bundle carries no pack's backend, so this is the path in a packaged build and from
// source alike, and the one place default-setup's actual runtime is loaded by the app's own boot rather than
// by a fixture.
//
// `bootPacks` composes the same two calls `api/src/runtime/index.ts` does, rather than running it: that
// module opens a server. So what it does *not* cover is that composition's own branches — an unset
// `SHIPPED_PACKS_DIR`, which only warns — and it passes no `hostVersion`, because this process's version is
// `0.0.0-test` and default-setup's manifest asks for more than that.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-packaged-boot-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { loadAppPacks } = await import('@apackdev/host/packs/runtime');
const { installPackFromLocal, installShippedPacks } = await import('@apackdev/host/packs');
const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
const { unbindHost } = await import('@apackdev/sdk/runtime/internals');
const { getDesignated } = await import('@apackdev/sdk/designations');

const PACKAGES_DIR = path.resolve(__dirname, '..', '..', '..');

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(resolveAppEnvironment().packsDir, { recursive: true, force: true }));

/** An installed pack that plays `role`, as `apack pack install` leaves one */
async function installPackPlaying(id: string, role: string): Promise<void> {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-`));
  fs.writeFileSync(path.join(source, 'apack.json'), JSON.stringify({ id, name: id, version: '1.0.0', features: { taker: { description: 'Feature declaration fixture.', designation: role } } }));
  fs.mkdirSync(path.join(source, 'dist', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(source, 'dist', 'types'), { recursive: true });
  fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  fs.writeFileSync(
    path.join(source, 'dist', 'runtime', 'index.cjs'),
    (`module.exports = { registration: { id: ${JSON.stringify(id)}, features: { taker: { designation: ${JSON.stringify(role)} } } } };`) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8')))}';`,
  );
  fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.feEntry), 'export {};');
  sealPackBuild(path.join(source, 'dist'), JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf8')));
  await installPackFromLocal(source, resolveAppEnvironment().packsDir);
  fs.rmSync(source, { recursive: true, force: true });
}

/**
 * The pack half of the app's boot: the shipped packs installed into the data dir, then every installed pack
 * loaded through the same admission path, without advertisement-based registration priority
 */
async function bootPacks(app: ReturnType<typeof openAppStore>) {
  await installShippedPacks(PACKAGES_DIR, resolveAppEnvironment().packsDir, { installedPacksFile: resolveAppEnvironment().installedPacksFile });
  return loadAppPacks(app.packs);
}

/** The app's boot, closed and unbound however the test ends */
async function packagedBoot(run: (app: ReturnType<typeof openAppStore>) => Promise<void>) {
  const app = openAppStore();
  try {
    await run(app);
  } finally {
    app.packs.runShutdownHooks();
    for (const pack of app.packs.loadedPacks()) app.packs.unregisterPack(pack.id);
    app.database.close();
    app.runHistory.database.close();
    unbindHost();
  }
}

it("installs each shipped pack and loads its built runtime, with its systems and surfaces", async () => {
  await packagedBoot(async (app) => {
    const { loaded } = await bootPacks(app);

    expect(loaded.map((pack) => pack.origin.id)).toContain('default-setup');
    expect(app.packs.systemIds()).toContain('default-setup/threads');
    expect(app.packs.surfaceIds()).toContain('default-setup/threads');
  });
});

// The bug this covers: an installed pack claiming a role the shipped pack designates took it, because the
// shipped packs were still loading when the external ones registered. `loadAppPacks` holds the order, and
// here it is held over the real packs and the real `brain` designation rather than a fixture's role name
it("keeps a shipped pack's role when an installed pack claims it", async () => {
  await installPackPlaying('role-taker', 'brain');

  await packagedBoot(async (app) => {
    const { loaded } = await bootPacks(app);

    expect(getDesignated('brain')).toBe('default-setup/brain');
    expect(loaded.map((pack) => pack.origin.id)).toEqual(['default-setup']);
    expect(app.packs.loadProblem('role-taker')).toContain('brain');
  });
});
