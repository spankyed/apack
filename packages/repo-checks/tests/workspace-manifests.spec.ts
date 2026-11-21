import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';
import { REPO_ROOT } from '../../../scripts/lib/packaged-app.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { OTHER_REPOSITORY_PACKAGES } from '@apackdev/host/build/bundled-packages';

/**
 * **A workspace manifest names every package by a version a registry could hold, and the root decides where the
 * code comes from.** The packages of the vendored checkouts (`elmdb`, `@elmdb/ears`, `@apackdev/git`,
 * `@apackdev/terminal`, `@apackdev/terminal-view`) are depended on as `0.1.0`, and the root's `overrides` maps each to
 * its `file:./vendor/...` path. A `file:` spec in a workspace manifest is a path only this checkout has: published,
 * it names nothing, and kept, it puts a second answer to "where does this come from" beside the root's.
 */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** `<package>: <field>.<dependency> is <spec>` for every `file:` spec the manifests hold */
function fileSpecs(manifests: ReadonlyArray<{ where: string; manifest: Record<string, unknown> }>): string[] {
  return manifests.flatMap(({ where, manifest }) => DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries((manifest[field] ?? {}) as Record<string, string>)
      .filter(([, spec]) => spec.startsWith('file:'))
      .map(([name, spec]) => `${where}: ${field}.${name} is ${spec}`)));
}

describe('workspace manifests', () => {
  it('hold no file: spec, which only the root overrides may', () => {
    const manifests = population('workspace manifests', PACKAGE_DIRS.map((dir) => ({
      where: `packages/${dir}/package.json`,
      manifest: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', dir, 'package.json'), 'utf8')) as Record<string, unknown>,
    })), { atLeast: 10 });
    expect(fileSpecs(manifests), 'name the package by version, and map it in the root package.json\'s "overrides"').toEqual([]);
  });

  it('are read in every dependency field', () => {
    expect(fileSpecs([{ where: 'x', manifest: Object.fromEntries(DEPENDENCY_FIELDS.map((field) => [field, { a: 'file:../a', b: '^1' }])) }]))
      .toEqual(DEPENDENCY_FIELDS.map((field) => `x: ${field}.a is file:../a`));
  });

  it("are the root's overrides' to point at a checkout", () => {
    const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { overrides?: Record<string, unknown> };
    const linked = Object.entries(root.overrides ?? {}).filter(([, spec]) => typeof spec === 'string' && spec.startsWith('file:./vendor/'));
    expect(population('vendored overrides', linked).map(([name]) => name).sort())
      .toEqual(['@apackdev/git', '@apackdev/terminal', '@apackdev/terminal-view', '@elmdb/ears', 'elmdb']);
    // The scope's packages another repository publishes are third-party to the notices and the bundle records
    // (`isFirstParty`), which knows them by name: the vendored ones of the scope, and no other
    expect(linked.map(([name]) => name).filter((name) => name.startsWith('@apackdev/')).sort()).toEqual([...OTHER_REPOSITORY_PACKAGES].sort());
  });
});
