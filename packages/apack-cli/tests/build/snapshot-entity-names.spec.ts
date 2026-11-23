import { _packEntityTypes } from '@apackdev/sdk/framework';
// A dependent reads only its *direct* dependencies' snapshots when it generates EntityName, so a chain
// A → B → C used to leave C's names unknown in A even though B surfaces them. A snapshot therefore
// records what its pack can surface — its own names and its dependencies' — which keeps resolution one
// level deep and makes the snapshot self-describing.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { checkoutShippedPacksDir } from '@apackdev/host/packs/assets';
import { PACK_LAYOUT } from '@apackdev/host/packs';

const starter = path.join(checkoutShippedPacksDir(REPO_ROOT), 'default-setup');
const starterManifest = path.join(starter, 'apack.json');

const snapshotFile = (builtLayout: string): string | undefined => {
  const file = path.join(builtLayout, PACK_LAYOUT.snapshot);
  return fs.existsSync(file) ? file : undefined;
};

const snapshotAt = (pack: string): { types: { entities: Record<string, string>; relKinds: Record<string, string> } } =>
  JSON.parse(fs.readFileSync(snapshotFile(pack)!, 'utf-8'));

describe('a built pack\'s snapshot', () => {
  const built = snapshotFile(starter) !== undefined;

  it.skipIf(!built)('records its own entity names', () => {
    const own = JSON.parse(fs.readFileSync(starterManifest, 'utf-8'));
    const snapshot = snapshotAt(starter);
    const ownNames = Object.keys(_packEntityTypes(own));
    // Derived from the manifest, so it is not a count to keep in step; it says the loop looked at something
    expect(ownNames.length).toBeGreaterThan(0);
    for (const name of ownNames) {
      expect(snapshot.types.entities, name).toHaveProperty(name);
    }
  });

  // tests/packs/external-pack depends on default-setup, so its snapshot is what a pack depending on
  // *it* would read. Before this, that pack could not name a default-setup entity.
  const fixture = path.join(REPO_ROOT, 'tests/packs/external-pack');
  const fixtureLayout = path.join(fixture, 'dist');
  const fixtureBuilt = snapshotFile(fixtureLayout) !== undefined;

  it.skipIf(!fixtureBuilt || !built)('records its dependencies\' entity names too, so a chain stays one level deep', () => {
    const dependencyNames = Object.keys(snapshotAt(starter).types.entities);
    const dependent = snapshotAt(fixtureLayout).types.entities;
    expect(dependencyNames.length).toBeGreaterThan(0);
    for (const name of dependencyNames) {
      expect(dependent, `${fixture} surfaces ${name}`).toHaveProperty(name);
    }
  });

  /**
   * Surfacing an inherited name is half of it; saying who declares it is the other half, and the half a
   * dependent of two packs sharing an ancestor depends on. The diamond spec proves the mechanism on
   * synthetic packs; this proves the real graph's snapshot carries it — written by the same
   * `apack pack build` a pack author runs.
   */
  it.skipIf(!fixtureBuilt || !built)("attributes an inherited entity to the pack that declares it, not the one it arrived through", () => {
    const declared = Object.keys(_packEntityTypes(JSON.parse(fs.readFileSync(starterManifest, 'utf-8'))));
    const recorded = JSON.parse(fs.readFileSync(snapshotFile(fixtureLayout)!, 'utf-8')).provenance?.entities ?? {};
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(recorded[name], `${fixture} attributes ${name}`).toBe('default-setup');
    }
  });

  // Surfaces travel the same way, for the diagnostic rather than for resolution: a pack depending on
  // the fixture can't send to a default-setup surface, and this is what lets the build say which pack
  // to depend on instead of reporting the surface as unknown.
  it.skipIf(!fixtureBuilt || !built)('records its dependencies\' surfaces, with the pack owning each', () => {
    const dependency = JSON.parse(fs.readFileSync(starterManifest, 'utf-8'));
    // Recorded under the id each surface runs under, so a pack that reuses one of its dependency's
    // feature ids has both recorded, each to its owner
    const owned = Object.entries(dependency.features ?? {}).filter(([, f]: [string, any]) => f.surface)
      .map(([id]) => `default-setup/${id}`);
    const recorded = JSON.parse(fs.readFileSync(snapshotFile(fixtureLayout)!, 'utf-8')).provenance?.surfaces ?? {};
    expect(owned.length).toBeGreaterThan(0);
    for (const id of owned) {
      expect(recorded[id], `${fixture} records ${id}`).toBe('default-setup');
    }
  });

  it.skipIf(!fixtureBuilt)('keeps its own names when a dependency declares one with the same key', () => {
    const own = JSON.parse(fs.readFileSync(path.join(fixture, 'apack.json'), 'utf-8'));
    const entities = snapshotAt(fixtureLayout).types.entities;
    expect(Object.keys(_packEntityTypes(own))).toEqual(['Memo']);
    for (const [name, value] of Object.entries(_packEntityTypes(own))) {
      expect(entities[name], name).toBe(value);
    }
  });
});
