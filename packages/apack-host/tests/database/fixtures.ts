// Data dirs for the database specs: a built-in pack published as the app publishes it, external packs installed,
// and a database written through the composition the app uses
import { writeInstalledPackFixture } from '../packs/runtime/build-fixture.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { untypedCreate, _bindEars } from '@apackdev/sdk/ears';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { openDatabaseStore } from '../../src/database/open.ts';
import { readInstalledSchema, type DatabaseSchema } from '../../src/database/schema.ts';
import { _appDirOf } from '@apackdev/sdk/env';

export const tempDirs: string[] = [];

export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(_appDirOf(dir), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function writeJSON(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

/**
 * A data dir with packs installed: `core`, which the app ships (Note, Trace, `mentions`, `pinned`), and any others
 * given. Every pack is installed, so they are all written the same way: one manifest per pack under
 * `packs/<id>/`, which is the data dir's one account of itself.
 */
export function dataDirWithPacks({ external = [] as Array<{ id: string; entities: Record<string, string>; enabled?: boolean }> } = {}): string {
  const dir = tempDir('host-database-');
  writeInstalledPackFixture(path.join(_appDirOf(dir), 'packs', 'core'), {
    id: 'core', name: 'Core', version: '1.0.0',
    data: { entities: { Note: {}, Trace: {} }, relations: { mentions: {} }, roles: ['pinned'] },
  });
  for (const pack of external) {
    writeInstalledPackFixture(path.join(_appDirOf(dir), 'packs', pack.id), {
      id: pack.id, name: pack.id, version: '1.0.0', data: { entities: Object.fromEntries(Object.keys(pack.entities).map(name => [name, {}])) },
    });
  }
  const listed = external.filter((pack) => pack.enabled !== undefined);
  if (listed.length > 0) {
    writeJSON(path.join(_appDirOf(dir), 'installed-packs.json'), {
      packs: listed.map((pack) => ({ id: pack.id, name: pack.id, version: '1.0.0', dir: path.join(_appDirOf(dir), 'packs', pack.id), enabled: pack.enabled, installedAt: '' })),
    });
  }
  return dir;
}

const context = (userDataDir: string) => ({
  userDataDir,
  packsDir: path.join(_appDirOf(userDataDir), 'packs'),
  installedPacksFile: path.join(_appDirOf(userDataDir), 'installed-packs.json'),
});

/** Writes through a store opened on the data dir, as the app writes (the engine installed meanwhile) */
export async function writeData(userDataDir: string, write: () => void): Promise<void> {
  const paths = _appDataPaths(userDataDir);
  const { database, engine } = openDatabaseStore({
    path: paths.lmdb,
    schema: readInstalledSchema(context(userDataDir)),
  });
  const previous = _bindEars(engine);
  try {
    write();
  } finally {
    _bindEars(previous);
    database.close();
  }
}

/** The names `schema` gives, and the entity types `types` besides: what a spec writing rows of its own types opens with */
export function schemaWith(schema: DatabaseSchema, types: readonly string[]): DatabaseSchema {
  return { ...schema, getRegisteredEntityTypes: () => new Set([...schema.getRegisteredEntityTypes(), ...types]) };
}

/** The database at `dir` and an engine over it, its schema declaring `types` too */
export function openWithTypes(dir: string, types: readonly string[]) {
  return openDatabaseStore({
    path: dir,
    schema: { getRegisteredEntityTypes: () => new Set(types), getRegisteredRelationKinds: () => new Set(), getRegisteredRoles: () => new Set() },
  });
}

export { context as schemaContext, untypedCreate };
