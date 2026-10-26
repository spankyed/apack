// openAppDatabase: a data dir's database opened outside the app, from the installed packs' manifests, in the layout
// it was written in
import { _declarationRevision, PACK_SNAPSHOT_FORMAT, type PackManifest } from '@apackdev/sdk/build';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EARS } from '@apackdev/ears';
import { openDatabase } from '@apackdev/ears/lmdb';
import { _createTestEngine } from '@apackdev/sdk/testing';
import { _bindEars, boundEars, untypedQuery } from '@apackdev/sdk/ears';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { openAppDatabase } from '../../src/database/open.ts';
import { findAppDataPaths } from '../../src/database/layout.ts';
import { readInstalledSchema } from '../../src/database/schema.ts';
import { dataDirWithPacks, removeTempDirs, schemaContext, tempDir, untypedCreate, writeData } from './fixtures.ts';
import { _appDirOf } from '@apackdev/sdk/env';

function writeSnapshot(file: string, manifest: PackManifest): void {
  fs.writeFileSync(file, JSON.stringify({ format: PACK_SNAPSHOT_FORMAT,
    declarationRevision: _declarationRevision(manifest), manifest, types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
}

afterEach(removeTempDirs);

const id = (name: string) => name as EARS.EntityId;
const quiet = { log: () => {} };

describe('readInstalledSchema', () => {
  it("takes entity types from every enabled pack's own manifest, the app's own packs included", () => {
    const dir = dataDirWithPacks({
      external: [
        { id: 'bookmarks', entities: { Bookmark: 'Bookmark' } },
        { id: 'listed', entities: { Pin: 'Pin' }, enabled: true },
        { id: 'off', entities: { Hidden: 'Hidden' }, enabled: false },
      ],
    });
    const schema = readInstalledSchema(schemaContext(dir));
    const types = schema.getRegisteredEntityTypes();
    for (const type of ['Note', 'Trace', 'Bookmark', 'Pin', 'Flow', 'AppState']) expect(types.has(type)).toBe(true);
    expect(types.has('Hidden')).toBe(false);
    // A relation is no entity type
    expect(types.has('Relation')).toBe(false);
    expect(schema.relKinds.MENTIONS).toBe('mentions');
    expect(schema.packs).toEqual([
      { id: 'bookmarks' },
      { id: 'core' },
      { id: 'listed' },
    ]);
  });

  // It used to throw, which is wrong for a tool whose job is looking at a data dir something is already wrong
  // with. It reports instead, and the caller decides: a dir with no published snapshots still opens and every
  // row is still reachable by id — what is lost is naming a pack's entity type in a query.
  // A data dir with nothing installed knows the app's own types and no pack's, which is the truth about it
  // rather than an incomplete reading of it — every pack that is there has its manifest there
  it('knows only the app\'s own types for a data dir with no packs installed', () => {
    const dir = tempDir('host-database-');
    const schema = readInstalledSchema(schemaContext(dir));
    expect(schema.packs).toEqual([]);
    expect(schema.degraded, 'reported, because a caller about to write needs to know').toMatch(/has no packs installed .*--schema-from/s);
    expect(schema.getRegisteredEntityTypes().has('AppState'), "the app's own types are still known").toBe(true);
    expect(schema.getRegisteredEntityTypes().has('Bookmark'), "a pack's are not").toBe(false);
  });

  // A flag that does nothing and says nothing is worse than one that errors: the path was only resolved when
  // the dir had no snapshots, so a typo against a healthy dir answered normally
  it('resolves the named snapshot even when it will not be needed, and says it was not', () => {
    const dir = dataDirWithPacks();
    expect(() => readInstalledSchema(schemaContext(dir), { schemaFrom: '/nope/x.json' })).toThrow(/No pack snapshot at/);

    const snapshot = path.join(dir, 'spare.json');
    writeSnapshot(snapshot, { id: 'spare', name: 'Spare', version: '1.0.0', data: { entities: {} } });
    // Named a pack the dir does not have, so it is read and added
    const { notes } = readInstalledSchema(schemaContext(dir), { schemaFrom: snapshot });
    expect(notes).toEqual([]);
  });

  it('refuses incomplete and stale named snapshots through the common snapshot validator', () => {
    const dir = tempDir('host-database-');
    const snapshot = path.join(dir, 'invalid.json');
    fs.writeFileSync(snapshot, JSON.stringify({ manifest: { id: 'named', data: { entities: {} } } }));
    expect(() => readInstalledSchema(schemaContext(dir), { schemaFrom: snapshot })).toThrow('this reader requires format');
    writeSnapshot(snapshot, { id: 'named', name: 'Named', version: '1.0.0' });
    const data = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
    data.manifest.data = { entities: { Added: {} } };
    fs.writeFileSync(snapshot, JSON.stringify(data));
    expect(() => readInstalledSchema(schemaContext(dir), { schemaFrom: snapshot })).toThrow('declarations do not match their revision');
  });

  // The snapshot a caller names stands in for the ones the data dir never published
  it('reads the entity types from a snapshot --schema-from names', () => {
    const dir = tempDir('host-database-');
    const snapshot = path.join(dir, 'snapshot.json');
    writeSnapshot(snapshot, { id: 'named', name: 'Named', version: '1.0.0', data: { entities: { Bookmark: {} } } });
    const schema = readInstalledSchema(schemaContext(dir), { schemaFrom: snapshot });
    expect(schema.getRegisteredEntityTypes().has('Bookmark')).toBe(true);
  });
});

describe('findAppDataPaths', () => {
  it('refuses a data dir with no database', async () => {
    const dir = dataDirWithPacks();
    expect(() => findAppDataPaths(dir)).toThrow(`No apack database in ${dir}`);
  });

  // The stores live under `appDir`, not beside Chromium's files. A dir holding only the old layout reads as
  // empty rather than as a database, which is the honest answer: nothing here writes there any more.
  it('does not read the layout the app wrote before it had a directory of its own', async () => {
    const dir = dataDirWithPacks();
    // Deliberately the two places the app wrote before `appDir`, spelled out rather than derived: the point
    // is that neither is read any more, which a helper that knows the current layout could not express
    fs.mkdirSync(path.join(dir, 'ears-db'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.data', 'ears-db'), { recursive: true });
    expect(() => findAppDataPaths(dir)).toThrow(`No apack database in ${dir}`);
  });
});

describe('openAppDatabase', () => {
  /**
   * The firing case for the refusal, and the reason it exists rather than a warning. With an incomplete schema
   * the engine does not know `Note` is an entity type, so `create('Note')` and `query('Note')` are refused one call
   * at a time, part way through whatever the tool was writing. A read of the same dir is fine and is the whole
   * point of the fallback.
   */
  // A dir whose packs were removed still holds their rows — uninstalling deletes a directory, not rows — so
  // "no pack installed" is a schema that cannot be written against, however true it is about the directory
  it('writes a data dir whose packs were removed by the schema the app declared, which the report lacks', async () => {
    const dir = dataDirWithPacks();
    await writeData(dir, () => {});
    fs.rmSync(path.join(_appDirOf(dir), 'packs'), { recursive: true });

    const db = await openAppDatabase({ env: 'test', userDataDir: dir, ...quiet });
    try {
      expect(db.schema.packs).toEqual([]);
      expect(db.schema.getRegisteredEntityTypes().has('Note')).toBe(false);
      // The database still declares Note, as the app last did
      expect(db.ears.create('Note').set('title', 'written').id().startsWith('Note-')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('refuses a writable open of a database that holds no schema, and allows a read', async () => {
    const dir = tempDir('host-database-');
    openDatabase({ path: _appDataPaths(dir).lmdb }).close();
    await expect(openAppDatabase({ env: 'test', userDataDir: dir, ...quiet })).rejects.toThrow(/holds no schema yet: start apack on it once/);
    const db = await openAppDatabase({ env: 'test', userDataDir: dir, readOnly: true, ...quiet });
    db.close();
  });

  // The escape hatch the refusal names, so the message is not a dead end
  it('takes the schema a caller names, and then writes', async () => {
    const dir = dataDirWithPacks();
    await writeData(dir, () => {});
    fs.rmSync(path.join(_appDirOf(dir), 'packs'), { recursive: true });
    const snapshot = path.join(dir, 'core.json');
    writeSnapshot(snapshot, { id: 'core', name: 'Core', version: '1.0.0', data: { entities: { Note: {} } } });

    const db = await openAppDatabase({ env: 'test', userDataDir: dir, schemaFrom: snapshot, ...quiet });
    try {
      expect(db.schema.degraded).toBeUndefined();
      expect(db.ears.create('Note').set('title', 'new').id().startsWith('Note-')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('hydrates the primary partition with the installed types, and installs the engine until close', async () => {
    const dir = dataDirWithPacks();
    await writeData(dir, () => {
      untypedCreate('Note', { id: id('Note-2') }).set('title', 'other');
      untypedCreate('Note', { id: id('Note-1') }).set('title', 'kept').grant('pinned').link('mentions', id('Note-2'));
    });

    const db = await openAppDatabase({ env: 'test', userDataDir: dir, ...quiet });
    expect(boundEars()).toBe(db.ears);
    expect(db.paths).toEqual(_appDataPaths(dir));
    expect(untypedQuery.withTrashed('Note').ids().sort()).toEqual(['Note-1', 'Note-2']);
    expect(untypedQuery('Note').ids()).toHaveLength(2);
    expect(db.ears.getRoles(id('Note-1'))).toEqual(['pinned']);
    expect(db.ears.findRelations({ source: id('Note-1') })).toHaveLength(1);
    db.close();

    const db2 = await openAppDatabase({ env: 'test', userDataDir: dir, ...quiet });
    expect(db2.ears.getRow(id('Note-1'))?.title).toBe('kept');
    // An entity type creates an entity
    const created = db2.ears.create('Note').set('title', 'new').id();
    expect(created.startsWith('Note-')).toBe(true);
    db2.close();
    expect(() => boundEars()).toThrow();

    const again = await openAppDatabase({ env: 'test', userDataDir: dir, readOnly: true, ...quiet });
    expect(again.ears.getRow(created)?.title).toBe('new');
    again.close();
  });

  it('refuses writes when read-only, and leaves the files as they were', async () => {
    const dir = dataDirWithPacks();
    await writeData(dir, () => { untypedCreate('Note', { id: id('Note-1') }).set('title', 'kept'); });
    const db = await openAppDatabase({ env: 'test', userDataDir: dir, readOnly: true, ...quiet });
    expect(() => db.ears.write(id('Note-1')).set('title', 'changed')).toThrow(/open read-only/);
    db.close();
    const again = await openAppDatabase({ env: 'test', userDataDir: dir, readOnly: true, ...quiet });
    expect(again.ears.getRow(id('Note-1'))?.title).toBe('kept');
    again.close();
  });

  it('puts back the engine that was installed before, however it ends', async () => {
    const dir = dataDirWithPacks();
    await writeData(dir, () => { untypedCreate('Note', { id: id('Note-1') }).set('title', 'kept'); });
    // A process that already has an engine: the app, or a test file that started a runtime
    const outer = _createTestEngine({ entityTypes: ['Note'] });
    _bindEars(outer);
    try {
      const db = await openAppDatabase({ env: 'test', userDataDir: dir, ...quiet });
      expect(boundEars()).toBe(db.ears);
      db.close();
      expect(boundEars()).toBe(outer);

      // And an open that fails installs nothing at all, rather than leaving this process without an engine
      const broken = dataDirWithPacks();
      await expect(openAppDatabase({ env: 'test', userDataDir: broken, ...quiet })).rejects.toThrow();
      expect(boundEars()).toBe(outer);
    } finally {
      _bindEars(undefined);
    }
  });

  it('opens nothing where the data dir has no database', async () => {
    const dir = dataDirWithPacks();
    await expect(openAppDatabase({ env: 'test', userDataDir: dir, readOnly: true, ...quiet })).rejects.toThrow('No apack database');
    expect(fs.existsSync(path.join(dir, '.data'))).toBe(false);
  });
});
