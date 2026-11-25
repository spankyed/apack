import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _declarationRevision, PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { cacheDependency, readCachedDependency, readDependencyBuild } from '../../src/packs/dependency-cache.ts';
import { PACK_LAYOUT, sealPackBuild } from '../../src/packs/layout.ts';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dependency-cache-')); });
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });

function producer(name = 'producer', executable = true): string {
  const directory = path.join(root, name);
  const manifest = { id: 'dep-pack', name: 'Dependency', version: '1.0.0' };
  fs.mkdirSync(path.join(directory, 'types'), { recursive: true });
  fs.writeFileSync(path.join(directory, PACK_LAYOUT.snapshot), JSON.stringify({
    format: PACK_SNAPSHOT_FORMAT, declarationRevision: _declarationRevision(manifest),
    manifest, types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
  }));
  if (executable) {
    fs.mkdirSync(path.join(directory, 'runtime'));
    fs.writeFileSync(path.join(directory, PACK_LAYOUT.runtimeEntry), 'throw new Error("Discovery executed the dependency");');
    fs.writeFileSync(path.join(directory, PACK_LAYOUT.feEntry), 'throw new Error("Frontend executed");');
    sealPackBuild(directory, manifest);
  }
  return directory;
}

function publish(source: string) {
  return cacheDependency(root, 'dep-pack', source, '^1.0.0', { kind: 'workspace', directory: source, selection: 'workspace' });
}

describe('verified dependency cache', () => {
  it('retains complete producer bytes and origin across read-only cache reuse without execution', () => {
    const source = producer();
    const cached = publish(source);
    expect(readCachedDependency(root, 'dep-pack')).toEqual(cached);
    expect(cached.resolution).toMatchObject({ spec: '^1.0.0', version: '1.0.0', kind: 'build',
      origin: { kind: 'workspace', directory: source, selection: 'workspace' } });
    for (const file of [PACK_LAYOUT.integrity, PACK_LAYOUT.feEntry, PACK_LAYOUT.runtimeEntry, PACK_LAYOUT.snapshot]) {
      expect(fs.readFileSync(path.join(cached.directory, file))).toEqual(fs.readFileSync(path.join(source, file)));
    }
  });

  it('keeps previously resolved paths intact when the same version resolves to different content', () => {
    const first = publish(producer());
    const source = producer('second');
    fs.writeFileSync(path.join(source, PACK_LAYOUT.runtimeEntry), 'throw new Error("Different build");');
    sealPackBuild(source, first.snapshot.manifest);
    const second = publish(source);
    expect(second.resolution.revision).not.toBe(first.resolution.revision);
    expect(readCachedDependency(root, 'dep-pack')).toEqual(second);
    expect(fs.readFileSync(path.join(first.directory, PACK_LAYOUT.runtimeEntry), 'utf8')).toContain('Discovery executed');
  });

  it.each(['changed', 'missing', 'extra'])('refuses %s cached files and repairs them only from a verified source', mode => {
    const source = producer();
    const cached = publish(source);
    const entry = path.join(cached.directory, PACK_LAYOUT.runtimeEntry);
    if (mode === 'changed') fs.writeFileSync(entry, 'tampered');
    else if (mode === 'missing') fs.rmSync(entry);
    else fs.writeFileSync(path.join(cached.directory, 'extra.js'), 'extra');
    expect(() => readCachedDependency(root, 'dep-pack')).toThrow('failed verification');
    expect(publish(source)).toEqual(cached);
    expect(readCachedDependency(root, 'dep-pack')).toEqual(cached);
  });

  it('copies snapshot-only type data without copying executable files that have no producer receipt', () => {
    const source = producer('unsealed', false);
    fs.mkdirSync(path.join(source, 'runtime'));
    fs.writeFileSync(path.join(source, PACK_LAYOUT.runtimeEntry), 'throw new Error("Unverified runtime");');
    const cached = publish(source);
    expect(cached.resolution.kind).toBe('type-data');
    expect(fs.readdirSync(cached.directory)).toEqual(['types']);
    expect(readCachedDependency(root, 'dep-pack')).toEqual(cached);
  });

  it('refuses a malformed producer receipt instead of downgrading executable files to type data', () => {
    const source = producer();
    fs.writeFileSync(path.join(source, PACK_LAYOUT.integrity), '{}');
    expect(() => publish(source)).toThrow('Invalid integrity.json');
    expect(readCachedDependency(root, 'dep-pack')).toBeNull();
  });

  it('refuses resolution records renamed under a different pack ID', () => {
    publish(producer());
    fs.renameSync(path.join(root, '.apack/deps/dep-pack'), path.join(root, '.apack/deps/other-pack'));
    expect(() => readCachedDependency(root, 'other-pack')).toThrow('Dependency "other-pack" resolution declares "dep-pack"');
  });

  it('rejects executable files added to a type-only cache', () => {
    const cached = publish(producer('type-only', false));
    fs.writeFileSync(path.join(cached.directory, 'execute.js'), 'throw new Error("Do not execute")');
    expect(() => readCachedDependency(root, 'dep-pack')).toThrow('unexpected files');
  });

  it.each(['inspection', 'publication'])('refuses a source replaced after snapshot capture during %s', operation => {
    const incumbent = publish(producer());
    const source = producer('next');
    const snapshotFile = path.join(source, PACK_LAYOUT.snapshot);
    const read = fs.readFileSync;
    let replaced = false;
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) => {
      const captured = read(file, options);
      if (!replaced && String(file) === snapshotFile) {
        replaced = true;
        const snapshot = JSON.parse(String(captured));
        snapshot.format = PACK_SNAPSHOT_FORMAT + 1;
        fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
        sealPackBuild(source, snapshot.manifest);
      }
      return captured;
    });
    syncBuiltinESMExports();
    expect(() => operation === 'inspection' ? readDependencyBuild(source) : publish(source))
      .toThrow('declarations differ from its verified build');
    expect(replaced).toBe(true);
    expect(readCachedDependency(root, 'dep-pack')).toEqual(incumbent);
  });

  it('preserves the incumbent when a copied build fails its captured producer receipt', () => {
    const incumbent = publish(producer());
    const source = producer('second');
    const copy = fs.cpSync;
    vi.spyOn(fs, 'cpSync').mockImplementation((...args) => {
      copy(...args);
      fs.writeFileSync(path.join(String(args[1]), PACK_LAYOUT.runtimeEntry), 'changed during copy');
    });
    syncBuiltinESMExports();
    expect(() => publish(source)).toThrow('failed verification');
    expect(readCachedDependency(root, 'dep-pack')).toEqual(incumbent);
  });

  it('preserves the incumbent when resolution-record publication fails', () => {
    const incumbent = publish(producer());
    const source = producer('second');
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith('/resolution.json')) throw new Error('record publication failed');
      rename(from, to);
    });
    syncBuiltinESMExports();
    expect(() => publish(source)).toThrow('record publication failed');
    expect(readCachedDependency(root, 'dep-pack')).toEqual(incumbent);
  });

  it('keeps readers on the incumbent while the next build is ready but its record is unpublished', () => {
    const incumbent = publish(producer());
    const source = producer('second');
    fs.writeFileSync(path.join(source, PACK_LAYOUT.runtimeEntry), 'throw new Error("Next build");');
    sealPackBuild(source, incumbent.snapshot.manifest);
    const rename = fs.renameSync;
    let observed = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith('/resolution.json')) {
        expect(readCachedDependency(root, 'dep-pack')).toEqual(incumbent);
        observed = true;
      }
      rename(from, to);
    });
    syncBuiltinESMExports();
    const next = publish(source);
    expect(observed).toBe(true);
    expect(readCachedDependency(root, 'dep-pack')).toEqual(next);
  });
});
