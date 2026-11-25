import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packFixture } from '../../src/testing/pack-fixture.ts';
import * as testing from '../../src/testing/index.ts';
import manifest from '../../package.json' with { type: 'json' };
import type { PackManifest } from '../../src/framework/declaration-types.ts';
import { _surfaceTargets } from '../../src/framework/surface-declaration.ts';
import { population } from '../../src/testing/population.ts';

const read = (dir: string, file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));

describe('packFixture', () => {
  /**
   * What "complete" has to mean, checked against the tree rather than against the literal that wrote it: a
   * manifest whose declared paths are all files. Trim any of them and a rule that reads contracts stops being
   * able to fire, which is the failure the shapes this replaces each had.
   */
  it('declares a feature whose every entry and contract is a file that is there', () => {
    const dir = packFixture();

    const features = read(dir, 'apack.json').features as NonNullable<PackManifest['features']>;
    const declared = Object.values(features).flatMap(feature => [
      feature.system!.entry, feature.system!.contract!.split('#')[0]!,
      ..._surfaceTargets(feature.surface!).map(([, target]) => target.split('#')[0]!),
      feature.surface!.contract!.split('#')[0]!,
    ]);

    population('the paths the fixture manifest declares', declared, { atLeast: 4 });
    expect(declared.filter((rel) => !fs.existsSync(path.join(dir, rel)))).toEqual([]);
  });

  it('has the subpath maps that make a # string a specifier rather than a colour', () => {
    expect(Object.keys(read(packFixture(), 'package.json').imports)).toEqual(['#generated/*', '#features/*']);
  });

  it('writes a case’s own files over the base, which is how a case adds its offending module', () => {
    const dir = packFixture({ files: { 'src/f.ts': 'export const offence = 1;\n' } });

    expect(fs.readFileSync(path.join(dir, 'src/f.ts'), 'utf-8')).toBe('export const offence = 1;\n');
    expect(fs.existsSync(path.join(dir, 'src/features/memos/be/contract.ts'))).toBe(true);
  });

  /**
   * The two manifest options, and the reason they are two.
   *
   * 23 of the 28 manifests written inline across the packages that may import this are the minimum plus at
   * most one key, so varying is the common case and `manifest` merges. The other five are *about* the
   * manifest — one the installer rejects, one missing a key — and a merge cannot express a key that is
   * absent, so `rawManifest` writes what it is given. Asking for both is a question with two answers.
   */
  it('varies the default manifest, keeping what the case is not about', () => {
    const written = read(packFixture({ manifest: { id: 'other' } }), 'apack.json');
    expect(written.id).toBe('other');
    expect(Object.keys(written.features), 'the feature the default declares is what makes a contract rule able to fire')
      .toEqual(['memos']);
  });

  it('writes a manifest verbatim when the manifest is the subject', () => {
    expect(read(packFixture({ rawManifest: { id: 'only-this' } }), 'apack.json')).toEqual({ id: 'only-this' });
  });

  /** What makes `@apackdev/*` resolve from inside the fixture, which every spec that builds one needs */
  it('links node_modules where it is asked to, and nowhere else', () => {
    const modules = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-fixture-modules-'));
    expect(fs.realpathSync(path.join(packFixture({ nodeModules: modules }), 'node_modules')))
      .toBe(fs.realpathSync(modules));
    expect(fs.existsSync(path.join(packFixture(), 'node_modules'))).toBe(false);
  });

  /**
   * The two ways this could become public API, which is the property the home rests on.
   *
   * It is repo test tooling: a fixture for the tools that *read* a pack directory, all of which are private
   * (`@apackdev/cli` publishes no declarations; the layout and specifier readers are `@apackdev/host`'s). Published,
   * its default manifest, its two manifest options and its stub files would be contract — and that default is
   * chosen to make this repo's pack rules fire.
   *
   * Only `@apackdev/source` on the entry is what keeps it out: `publishedManifest` drops an entry that condition
   * was the whole of, so it reaches no tarball and no `etc/*.api.md`, and a pack cannot resolve it because a
   * pack's config may not declare the condition. Adding a `types` branch would at least surface as a new
   * report file; adding only a `default` one, or re-exporting it from the published `./testing`, would not.
   * Hence both halves below rather than trusting the review of a diff.
   */
  it('is reachable only under the source condition, so it reaches no tarball', () => {
    // Read off the typed manifest, so removing the entry fails to compile rather than passing vacuously
    expect(Object.keys(manifest.exports['./testing/pack-fixture'])).toEqual(['@apackdev/source']);
  });

  it('is not exported from ./testing, which is published', () => {
    expect(Object.keys(testing)).not.toContain('packFixture');
  });

  it('refuses both at once rather than picking one', () => {
    expect(() => packFixture({ manifest: { id: 'a' }, rawManifest: { id: 'b' } }))
      .toThrow(/not both/);
  });
});
