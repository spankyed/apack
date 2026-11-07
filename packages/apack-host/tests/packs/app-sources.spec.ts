import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackManifest } from '@apackdev/sdk/build';
import { readAppPackSources } from '../../src/packs/app-sources.ts';
import { createContributionCatalog } from '../../src/packs/catalog.ts';
import { createPackRegistry } from '../../src/packs/registry.ts';
import { installPackFromLocal, restoreShippedPack } from '../../src/packs/installer.ts';
import { PACK_LAYOUT, readPackBuild } from '../../src/packs/layout.ts';
import { sealBuild, writeInstalledPackFixture } from './runtime/build-fixture.ts';

let tmp: string;
let root: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-app-sources-'));
  root = path.join(tmp, 'sources');
  fs.mkdirSync(root);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function source(folder: string, id = 'default-pack', title = 'App default'): string {
  const dir = path.join(root, folder);
  const manifest: PackManifest = { id, name: title, version: '1.0.0', extensions: {
    settings: { assistant: { schema: { type: 'object', properties: { title: { type: 'string' } },
      required: ['title'], additionalProperties: false }, defaults: { title } } },
  } };
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify(manifest));
  writeInstalledPackFixture(path.join(dir, 'dist'), manifest);
  const marker = path.join(tmp, 'activated');
  fs.writeFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry),
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'activated'); throw new Error('No source activation');`);
  sealBuild(dir);
  return dir;
}

describe('app-shipped source declarations', () => {
  it('uses the verified manifest id, reads no executable code and writes nothing', () => {
    const dir = source('different-folder');
    const receipt = path.join(dir, 'dist', PACK_LAYOUT.integrity);
    const before = fs.statSync(receipt).mtimeMs;
    const reads = vi.spyOn(fs, 'readFileSync');
    syncBuiltinESMExports();
    let input;
    try {
      input = readAppPackSources(root);
      for (const file of [receipt, path.join(dir, 'dist', PACK_LAYOUT.snapshot)]) {
        expect(reads.mock.calls.filter(([name]) => name === file)).toHaveLength(1);
      }
    } finally { reads.mockRestore(); syncBuiltinESMExports(); }
    expect(input.problems).toEqual([]);
    expect(input.sources).toMatchObject([{ id: 'default-pack', dir,
      sourceRevision: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(input.sources[0].files).toEqual(readPackBuild(path.join(dir, 'dist')).integrity.files);
    expect(fs.statSync(receipt).mtimeMs).toBe(before);
    expect(fs.readdirSync(tmp).sort()).toEqual(['sources']);
  });

  it.each(['unbuilt', 'edited-runtime', 'edited-manifest'])('reports %s without offering an unchecked source', kind => {
    const dir = source('default');
    if (kind === 'unbuilt') fs.rmSync(path.join(dir, 'dist'), { recursive: true });
    if (kind === 'edited-runtime') fs.appendFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry), '\n// edited');
    if (kind === 'edited-manifest') {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, PACK_LAYOUT.manifest), 'utf8'));
      fs.writeFileSync(path.join(dir, PACK_LAYOUT.manifest), JSON.stringify({ ...manifest, name: 'Changed' }));
    }
    const input = readAppPackSources(root);
    expect(input.sources).toEqual([]);
    expect(input.problems).toMatchObject([{ id: 'default-pack', dir, message: expect.any(String) }]);
    expect(fs.existsSync(path.join(tmp, 'activated'))).toBe(false);
  });

  it.each([false, true])('refuses every duplicate claimant, including an invalid build: %s', corrupt => {
    const first = source('first');
    const second = source('second');
    if (corrupt) fs.rmSync(path.join(second, 'dist'), { recursive: true });
    const input = readAppPackSources(root);
    expect(input.sources).toEqual([]);
    const conflicts = input.problems.filter(problem => problem.message.includes('Duplicate'));
    expect(conflicts.map(problem => problem.dir)).toEqual([first, second]);
    for (const problem of conflicts) {
      expect(problem.message).toContain(first);
      expect(problem.message).toContain(second);
    }
  });

  it('publishes frozen offers separately from a disabled user fork and its settings', () => {
    source('default');
    const catalog = createContributionCatalog({ schema: { type: 'object' }, defaults: {} });
    const fork = source('fork', 'default-pack', 'User fork');
    const installed = readPackBuild(path.join(fork, 'dist'));
    catalog.replace([{ ...installed, dir: '/installed/default-pack', enabled: false }]);
    const settings = catalog.settings();
    fs.rmSync(fork, { recursive: true });
    const offers = readAppPackSources(root);
    catalog.setAppPackSources(offers);
    expect(catalog.settings()).toBe(settings);
    expect(catalog.packSettings('default-pack').assistant.defaults.title).toBe('User fork');
    expect(catalog.get('default-pack')?.enabled).toBe(false);
    expect(catalog.help().articles).toEqual([]);
    const accepted = catalog.getSnapshot();
    expect(Object.isFrozen(accepted.appPackSources[0].files)).toBe(true);
    expect(Object.isFrozen(accepted.appPackSources[0].snapshot.manifest)).toBe(true);
    offers.sources[0].snapshot.manifest.name = 'Mutated reader';
    expect(accepted.appPackSources[0].snapshot.manifest.name).toBe('App default');
    catalog.replace([]);
    expect(catalog.getSnapshot().appPackSources).toEqual(accepted.appPackSources);
    expect(catalog.packSettings('default-pack')).toEqual({});
  });

  it('refuses mismatched source identity without publishing or notifying', () => {
    source('default');
    const catalog = createContributionCatalog({ schema: { type: 'object' }, defaults: {} });
    const input = readAppPackSources(root);
    catalog.setAppPackSources(input);
    const accepted = catalog.getSnapshot();
    let notifications = 0;
    catalog.onChanged(() => notifications++);
    const corrupted = { ...input.sources[0], sourceRevision: '0'.repeat(64) };
    expect(() => catalog.setAppPackSources({ sources: [corrupted], problems: [] })).toThrow('Invalid or conflicting');
    expect(catalog.getSnapshot()).toBe(accepted);
    expect(notifications).toBe(0);
  });

  it('withdraws offers when the configured source disappears without activating packs', () => {
    source('default');
    let directory: string | undefined = root;
    const registry = createPackRegistry({ appPackSourcesDir: () => directory });
    registry.refreshCatalog({ settings: 'enforce' });
    expect(registry.catalog.getSnapshot().appPackSources).toHaveLength(1);
    expect(registry.loadedPacks()).toEqual([]);
    directory = undefined;
    registry.refreshCatalog({ settings: 'enforce' });
    expect(registry.catalog.getSnapshot().appPackSources).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'activated'))).toBe(false);
  });

  it('refuses a changed restoration source and retains the incumbent files and installation record', async () => {
    const dir = source('default');
    const packs = path.join(tmp, 'packs');
    const records = path.join(tmp, 'installed-packs.json');
    await installPackFromLocal(dir, packs, { installedPacksFile: records });
    const before = fs.readFileSync(records, 'utf8');
    const incumbent = readPackBuild(path.join(packs, 'default-pack'));
    const offer = readAppPackSources(root).sources[0];
    fs.appendFileSync(path.join(dir, 'dist', PACK_LAYOUT.runtimeEntry), '\n// rebuilt');
    sealBuild(dir);
    await expect(restoreShippedPack('default-pack', dir, packs, {
      installedPacksFile: records, expectedSourceRevision: offer.sourceRevision,
    })).rejects.toThrow('changed before restoration acceptance');
    expect(fs.readFileSync(records, 'utf8')).toBe(before);
    expect(readPackBuild(path.join(packs, 'default-pack')).revision).toBe(incumbent.revision);
  });
});

it('publishes offers and installed declarations together, with no publication after refusal or unchanged input', () => {
  source('default');
  const offers = readAppPackSources(root);
  const catalog = createContributionCatalog({ defaults: {}, schema: { type: 'object' } });
  const build = readPackBuild(path.join(offers.sources[0]!.dir, 'dist'));
  const installed = [{ dir: '/installed/default-pack', snapshot: build.snapshot, integrity: build.integrity, enabled: true }];
  const observations: Array<[number, number]> = [];
  catalog.onChanged(() => observations.push([catalog.getSnapshot().appPackSources.length, catalog.getSnapshot().packs.length]));
  catalog.replace(installed, [], { appSources: offers });
  expect(observations).toEqual([[1, 1]]);
  const accepted = catalog.getSnapshot();
  catalog.replace(installed, [], { appSources: offers });
  expect(catalog.getSnapshot()).toBe(accepted);
  expect(() => catalog.replace([], [], { appSources: { sources: [{ ...offers.sources[0]!, sourceRevision: 'invalid' }], problems: [] } })).toThrow('Invalid or conflicting');
  expect(catalog.getSnapshot()).toBe(accepted);
  expect(observations).toEqual([[1, 1]]);
});
