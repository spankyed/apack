// readInstalledSchema reads what the packs installed in a data dir declare, and says which file is wrong when one is
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readInstalledSchema } from '../../src/database/schema.ts';
import { writeInstalledPackFixture } from '../packs/runtime/build-fixture.ts';
import { dataDirWithPacks, removeTempDirs, schemaContext, tempDir } from './fixtures.ts';
import { _appDirOf } from '@apackdev/sdk/env';

afterEach(removeTempDirs);

const manifestFile = (dir: string, id: string) => path.join(_appDirOf(dir), 'packs', id, 'apack.json');
const write = (file: string, content: unknown) =>
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));

describe('a file readInstalledSchema cannot use', () => {
  // One kind of file to report on, since every pack is read from its own installed manifest: whichever pack
  // is wrong, what the error names is an `apack.json` under `packs/`
  it("names the pack's manifest, whichever pack it is", () => {
    const dir = dataDirWithPacks({ external: [{ id: 'bookmarks', entities: { Bookmark: 'Bookmark' } }] });
    write(manifestFile(dir, 'bookmarks'), { id: 'bookmarks', name: 'Bookmarks', version: '1.0.0', data: { relations: 'nonsense' } });
    expect(() => readInstalledSchema(schemaContext(dir))).toThrow(`Pack "bookmarks" declarations in ${path.dirname(manifestFile(dir, 'bookmarks'))}: its manifest does not match its built declarations`);
  });

  // The pack the app ships is read exactly the same way, from the same place
  it("names the manifest of a pack the app ships", () => {
    const dir = dataDirWithPacks();
    write(manifestFile(dir, 'core'), { id: 'core', name: 'Core', version: '1.0.0', data: { entities: ['Note'] } });
    expect(() => readInstalledSchema(schemaContext(dir))).toThrow(`Pack "core" declarations in ${path.dirname(manifestFile(dir, 'core'))}: its manifest does not match its built declarations`);
  });

  it("refuses a registry it can't read, rather than taking in packs the app leaves out", () => {
    const dir = dataDirWithPacks({ external: [{ id: 'off', entities: { Hidden: 'Hidden' }, enabled: false }] });
    const registry = path.join(_appDirOf(dir), 'installed-packs.json');
    expect(readInstalledSchema(schemaContext(dir)).getRegisteredEntityTypes().has('Hidden')).toBe(false);

    write(registry, 'not json');
    expect(() => readInstalledSchema(schemaContext(dir))).toThrow(`Cannot read ${registry}`);
    write(registry, { packs: 'nonsense' });
    expect(() => readInstalledSchema(schemaContext(dir))).toThrow(`Cannot read ${registry}: Invalid installed pack records`);
  });
});

describe('packs declaring the same name', () => {
  it('are refused, as the app refuses to register them', () => {
    const colliding = dataDirWithPacks({ external: [{ id: 'a', entities: { Shared: 'Shared' } }, { id: 'b', entities: { Shared: 'Shared' } }] });
    expect(() => readInstalledSchema(schemaContext(colliding))).toThrow('Two packs declare the entity type Shared: "a" and "b"');

    const overApp = dataDirWithPacks({ external: [{ id: 'a', entities: { Flow: 'Flow' } }] });
    expect(() => readInstalledSchema(schemaContext(overApp))).toThrow('"Flow" is defined by the SDK and available to every pack: remove it');
  });
});

it('discovers feature-owned typed and untyped entities without authored source or executable imports', () => {
  const dir = dataDirWithPacks();
  const packDir = path.dirname(manifestFile(dir, 'offline'));
  writeInstalledPackFixture(packDir, {
    id: 'offline', name: 'Offline', version: '1.0.0',
    data: { relations: { note_link: {} } },
    features: { notes: { description: 'Feature declaration fixture.', entities: { OfflineNote: { shape: 'src/types.ts#NoteShape' }, OfflineIndex: {} } } },
  });
  expect(fs.existsSync(path.join(packDir, 'src'))).toBe(false);
  const schema = readInstalledSchema(schemaContext(dir));
  expect(schema.entities.OfflineNote).toBe('OfflineNote');
  expect(schema.entities.OfflineIndex).toBe('OfflineIndex');
  expect(schema.relKinds.NOTE_LINK).toBe('note_link');
});

describe("a pack's short code prefixes, read from its manifest", () => {
  const numbered = (id: string, entity: string, prefix: string) => ({
    id, name: id, version: '1.0.0', data: { entities: { [entity]: { shortCode: prefix } } },
  }) as Parameters<typeof writeInstalledPackFixture>[1];

  it("number a pack's entity type outside the app, as the app numbers it, beside the SDK's rules", () => {
    const dir = dataDirWithPacks();
    writeInstalledPackFixture(path.dirname(manifestFile(dir, 'memos')), numbered('memos', 'Memo', 'MEM'));
    const schema = readInstalledSchema(schemaContext(dir));
    expect(schema.getRowRules?.('Memo')).toEqual({ required: [], shortCode: 'MEM' });
    expect(schema.getRowRules?.('Document')).toMatchObject({ shortCode: 'DOC' });
    expect(schema.getRowRules?.('Unnumbered')).toBeUndefined();
    expect([schema.entityTypeOfShortCode('MEM-4'), schema.entityTypeOfShortCode('DOC-4'), schema.entityTypeOfShortCode('XYZ-4')]).toEqual(['Memo', 'Document', undefined]);
  });

  it('are refused when two packs share one, as the app refuses to register them', () => {
    const dir = dataDirWithPacks();
    writeInstalledPackFixture(path.dirname(manifestFile(dir, 'a')), numbered('a', 'Memo', 'MEM'));
    writeInstalledPackFixture(path.dirname(manifestFile(dir, 'b')), numbered('b', 'Member', 'MEM'));
    expect(() => readInstalledSchema(schemaContext(dir))).toThrow('The short code prefix MEM numbers both Memo of pack "a" and Member of pack "b"');
  });

  it("are refused when a pack takes one of the SDK's, naming the SDK's type", () => {
    const dir = dataDirWithPacks();
    writeInstalledPackFixture(path.dirname(manifestFile(dir, 'a')), numbered('a', 'Paper', 'DOC'));
    expect(() => readInstalledSchema(schemaContext(dir))).toThrow(/DOC.*the SDK's Document/);
  });
});

// `--schema-from` names a place, so one flag covers every pack behind it: a snapshot file, a pack directory, or a
// directory of pack directories. Each shape in the wild supplies a different file, which is what the probe order is for.
describe('--schema-from', () => {
  const pack = (id: string, entity: string) => ({
    id, name: id, version: '1.0.0', data: { entities: { [entity]: {} } },
  }) as Parameters<typeof writeInstalledPackFixture>[1];

  /** A published or installed pack: the snapshot and no manifest, which is what `host-packs/` holds */
  function snapshotOnlyPack(dir: string, id: string, entity: string): string {
    writeInstalledPackFixture(dir, pack(id, entity));
    fs.rmSync(path.join(dir, 'apack.json'));
    return dir;
  }

  it('reads a pack directory that has the snapshot and no manifest at all', () => {
    const dir = dataDirWithPacks();
    const from = snapshotOnlyPack(path.join(tempDir('schema-from-'), 'published'), 'bookmarks', 'Bookmark');
    expect(fs.existsSync(path.join(from, 'apack.json'))).toBe(false);

    const schema = readInstalledSchema(schemaContext(dir), { schemaFrom: from });
    expect(schema.entities.Bookmark).toBe('Bookmark');
    expect(schema.packs.map(({ id }) => id)).toContain('bookmarks');
  });

  it("reads a checkout's pack, whose snapshot is under dist/", () => {
    const dir = dataDirWithPacks();
    const from = path.join(tempDir('schema-from-'), 'a-pack');
    writeInstalledPackFixture(path.join(from, 'dist'), pack('bookmarks', 'Bookmark'));
    fs.writeFileSync(path.join(from, 'apack.json'), JSON.stringify(pack('bookmarks', 'Bookmark')));

    expect(readInstalledSchema(schemaContext(dir), { schemaFrom: from }).entities.Bookmark).toBe('Bookmark');
  });

  it('reads a pack declared only by its manifest, with nothing built', () => {
    const dir = dataDirWithPacks();
    const from = path.join(tempDir('schema-from-'), 'unbuilt');
    fs.mkdirSync(from, { recursive: true });
    fs.writeFileSync(path.join(from, 'apack.json'), JSON.stringify(pack('bookmarks', 'Bookmark')));

    expect(readInstalledSchema(schemaContext(dir), { schemaFrom: from }).entities.Bookmark).toBe('Bookmark');
  });

  // The whole point of naming a place: this is what retires wanting the flag more than once
  it('reads every pack in a directory of packs, with one flag', () => {
    const dir = dataDirWithPacks();
    const from = tempDir('schema-from-');
    snapshotOnlyPack(path.join(from, 'bookmarks'), 'bookmarks', 'Bookmark');
    snapshotOnlyPack(path.join(from, 'journal'), 'journal', 'Entry');
    fs.writeFileSync(path.join(from, 'not-a-pack.txt'), 'ignored');

    const schema = readInstalledSchema(schemaContext(dir), { schemaFrom: from });
    expect(schema.entities.Bookmark).toBe('Bookmark');
    expect(schema.entities.Entry).toBe('Entry');
    expect(schema.packs.map(({ id }) => id).sort()).toEqual(['bookmarks', 'core', 'journal']);
  });

  // A pack directory never holds packs, so the narrower reading is tried first and a pack whose own
  // subdirectory happens to look like one is still read as itself
  it('reads a pack directory as one pack, not as a directory of them', () => {
    const dir = dataDirWithPacks();
    const from = snapshotOnlyPack(path.join(tempDir('schema-from-'), 'outer'), 'bookmarks', 'Bookmark');
    snapshotOnlyPack(path.join(from, 'vendored'), 'journal', 'Entry');

    const schema = readInstalledSchema(schemaContext(dir), { schemaFrom: from });
    expect(schema.entities.Bookmark).toBe('Bookmark');
    expect(schema.entities.Entry).toBeUndefined();
  });

  it('refuses a path that names no pack, rather than adding nothing in silence', () => {
    const dir = dataDirWithPacks();
    const empty = tempDir('schema-from-');
    fs.writeFileSync(path.join(empty, 'readme.md'), 'no packs here');

    expect(() => readInstalledSchema(schemaContext(dir), { schemaFrom: empty })).toThrow(`${empty} holds no pack`);
    expect(() => readInstalledSchema(schemaContext(dir), { schemaFrom: path.join(empty, 'gone') })).toThrow('No pack or pack directory at');
    expect(() => readInstalledSchema(schemaContext(dir), { schemaFrom: path.join(empty, 'gone.json') })).toThrow('No pack snapshot at');
  });

  it('says so when the packs it names are installed already', () => {
    const dir = dataDirWithPacks();
    const from = tempDir('schema-from-');
    snapshotOnlyPack(path.join(from, 'core'), 'core', 'Note');
    snapshotOnlyPack(path.join(from, 'journal'), 'journal', 'Entry');

    const schema = readInstalledSchema(schemaContext(dir), { schemaFrom: from });
    expect(schema.notes).toEqual([`${dir} already has core installed, so --schema-from ${from} added journal.`]);
    expect(schema.entities.Entry).toBe('Entry');
  });
});
