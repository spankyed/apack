import { _declarationRevision } from '@apackdev/sdk/build';
// The API's boot and a tool opening the data dir (openAppDatabase, which apack db uses) read the same entities,
// relations and roles: both open the store through @apackdev/host/database, and the tool reads the installed packs'
// manifests where the API registers their code. Runs the built-in packs' built runtimes (npm run build:default-setup).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Ears } from '@apackdev/ears';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-database-parity-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { loadAppPacks, startPacks } = await import('@apackdev/host/packs/runtime');
const { installPackFromLocal, installShippedPacks } = await import('@apackdev/host/packs');
const { openAppDatabase } = await import('@apackdev/host/database');
const { resolveAppEnvironment } = await import('@apackdev/sdk/env');
const { unbindHost } = await import('@apackdev/sdk/runtime/internals');
const { untypedCreate } = await import('@apackdev/sdk/ears');

const PACKAGES_DIR = path.resolve(__dirname, '..', '..', '..');

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

/** Every entity with its attributes and roles, and every relation, in a stable order */
function snapshot(ears: Ears) {
  // Every entity, the trash included, and every relation's row
  const ids = [...ears.query.withTrashed.all().ids(), ...ears.findRelations().map((r) => r.id)].sort();
  return {
    entities: ids.map((id) => ({ id, attributes: ears.getRow(id), roles: [...ears.getRoles(id)].sort() })),
    relations: ears.findRelations()
      .map(({ id, kind, source, target, info }) => ({ id, kind, source, target, info }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * The API's boot up to loading the packs (`setupBackend`): the packs the app ships installed into the data dir,
 * then every installed pack loaded. The caller closes the store.
 */
async function bootApi() {
  const app = openAppStore();
  await installShippedPacks(PACKAGES_DIR, resolveAppEnvironment().packsDir, { installedPacksFile: resolveAppEnvironment().installedPacksFile });
  loadAppPacks(app.packs);
  return app;
}

function closeApi(app: Awaited<ReturnType<typeof bootApi>>) {
  app.packs.runShutdownHooks();
  for (const pack of app.packs.loadedPacks()) app.packs.unregisterPack(pack.id);
  app.database.close();
  app.runHistory.database.close();
  unbindHost();
}

/**
 * Installs an external pack declaring its own entity type, as `apack pack install` leaves one: the API registers its
 * runtime, the tool reads the manifest beside it
 */
async function installExternalPack(id: string, entityType: string): Promise<void> {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-`));
  const ears = { entities: { [entityType]: entityType }, relKinds: {}, roles: {} };
  fs.writeFileSync(path.join(source, 'apack.json'), JSON.stringify({ id, name: id, version: '1.0.0', data: { entities: { [entityType]: {} }, relations: {} }, }));
  fs.mkdirSync(path.join(source, 'dist', 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(source, 'dist', 'types'), { recursive: true });
  fs.writeFileSync(path.join(source, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
  fs.writeFileSync(
    path.join(source, 'dist', 'runtime', 'index.cjs'),
    (`module.exports = { registration: { id: ${JSON.stringify(id)}, ears: ${JSON.stringify(ears)} } };`) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf-8')))}';`,
  );
  sealPackBuild(path.join(source, 'dist'), JSON.parse(fs.readFileSync(path.join(source, 'apack.json'), 'utf8')));
  await installPackFromLocal(source, resolveAppEnvironment().packsDir);
  fs.rmSync(source, { recursive: true, force: true });
}

describe('a data dir opened by the API and by openAppDatabase', () => {
  it('reads the same entities, relations and roles', async () => {
    // A first run applies the app's content; the user adds a note with a role and a relation
    const first = await bootApi();
    await startPacks(first.packs);
    untypedCreate('Note', { id: 'Note-child', title: 'child', content: '', icon: null, noteType: 'document', completed: false, hideCompletedChildren: false, displayOrder: 0, lastSeen: 0 });
    untypedCreate('Note', { id: 'Note-parity', title: 'mine', content: '', icon: null, noteType: 'document', completed: false, hideCompletedChildren: false, displayOrder: 0, lastSeen: 0 }).grant('assistant_birth').link('parent_of', 'Note-child');
    closeApi(first);

    const api = await bootApi();
    const fromApi = snapshot(api.engine);
    const types = api.packs.getRegisteredEntityTypes();
    closeApi(api);

    const db = await openAppDatabase({ env: 'test', userDataDir: dataDir, readOnly: true });
    const fromTool = snapshot(db.ears);
    db.close();

    expect(fromApi.entities.length).toBeGreaterThan(10);
    expect(fromApi.relations.length).toBeGreaterThan(0);
    expect(fromApi.entities.some(({ roles }) => roles.length > 0)).toBe(true);
    expect(fromApi.entities.find(({ id }) => id === 'Note-parity')).toMatchObject({ roles: ['assistant_birth'] });
    expect(fromTool).toEqual(fromApi);
    // The tool knows the built-in pack's entity types
    expect(db.schema.getRegisteredEntityTypes()).toEqual(types);
  });
});

// The tool writes through the schema the app declared, so a row it creates is held to the rules the API's packs hold
// theirs to, and lands where the API reads it
describe('what the tool writes', () => {
  it('lands where the API reads it', async () => {
    const booted = await bootApi();
    closeApi(booted);

    const db = await openAppDatabase({ env: 'test', userDataDir: dataDir });
    // Every field a Note holds, as the app's schema requires
    expect(() => untypedCreate('Note', { id: 'Note-bare' })).toThrow(expect.objectContaining({ code: 'REQUIRED_FIELD' }));
    untypedCreate('Note', { id: 'Note-tool', title: 'from the tool', content: '', icon: null, noteType: 'document', completed: false, hideCompletedChildren: false, displayOrder: 0, lastSeen: 0 }).grant('assistant_birth');
    db.close();

    const api = await bootApi();
    try {
      // The note is in the data the API reads, with its role
      expect(api.engine.getRow('Note-tool')?.title).toBe('from the tool');
      expect([...api.engine.getRoles('Note-tool')]).toEqual(['assistant_birth']);
    } finally {
      closeApi(api);
    }
  });
});

// The tool takes the entity types of every installed pack, not only the built-in ones: an external pack's rows are
// its user's data like any other
describe('an installed external pack', () => {
  it('is in the entity types the tool reconstructs, as it is in the API\'s registry', async () => {
    await installExternalPack('memo-pack', 'Memo');

    const api = await bootApi();
    const types = [...api.packs.getRegisteredEntityTypes()];
    closeApi(api);

    const db = await openAppDatabase({ env: 'test', userDataDir: dataDir, readOnly: true });
    try {
      expect(types).toContain('Memo');
      expect(db.schema.getRegisteredEntityTypes()).toEqual(new Set(types));
      expect(db.schema.entities.Memo).toBe('Memo');
    } finally {
      db.close();
    }
  });
});
