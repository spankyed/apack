import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { population } from '@apackdev/sdk/testing';
import { REPO_ROOT } from '../../../scripts/lib/packaged-app.ts';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';
import { OTHER_REPOSITORY_PACKAGES, isFirstParty } from '@apackdev/host/build/bundled-packages';
import { REPOSITORIES, releaseOf, releaseUrl, repositoryOf } from '../../../scripts/lib/external-packages.mjs';

/**
 * **A workspace manifest names every package by a version a registry could hold, and the root decides where the
 * code comes from.** The packages of our other repositories (`elmdb`, `@elmdb/ears`, `@apackdev/git`,
 * `@apackdev/terminal`, `@apackdev/terminal-view`) are depended on as `0.1.0`, and the root's `overrides` maps each to
 * the tarball its repository's release holds (`npm run deps:pin`), or to a local checkout while one is worked on
 * (`npm run deps:local`). A `file:` spec in a workspace manifest is a path only this checkout has: published, it names
 * nothing, and kept, it puts a second answer to "where does this come from" beside the root's.
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

  it("are the root's overrides' to point at a release or a checkout", () => {
    const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { overrides?: Record<string, unknown> };
    const external = Object.entries(root.overrides ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^(https:|file:)/.test(entry[1]));
    expect(population('overrides naming a release or a checkout', external).map(([name]) => name).sort())
      .toEqual(Object.values(REPOSITORIES).flatMap(({ packages }) => Object.keys(packages)).sort());
    // A URL is the one `deps:pin` writes for its repository: the release of a commit, and that release's file for it
    for (const [name, spec] of external.filter(([, spec]) => spec.startsWith('https:'))) {
      const release = releaseOf(spec);
      expect(release?.repo, `${name}: ${spec}`).toBe(repositoryOf(name));
      expect(spec).toBe(releaseUrl(release!.repo, release!.commit, name));
    }
    // The scope's packages another repository publishes are third-party to the notices and the bundle records
    // (`isFirstParty`), which knows them by name: the external ones of the scope, and no other
    expect(external.map(([name]) => name).filter((name) => name.startsWith('@apackdev/')).sort()).toEqual([...OTHER_REPOSITORY_PACKAGES].sort());
    // And so is the platform package `@apackdev/terminal` installs its broker from, which no override names
    expect(['@apackdev/terminal-darwin-arm64', '@apackdev/terminal-win32-x64', '@apackdev/terminal-view', '@apackdev/sdk'].map(isFirstParty))
      .toEqual([false, false, false, true]);
  });

  it('read a URL as a release only when it is one of ours', () => {
    const commit = 'a'.repeat(40);
    expect(releaseOf(releaseUrl('elmdb', commit, 'elmdb'))).toEqual({ repo: 'elmdb', commit });
    expect(releaseOf(`https://github.com/someone/elmdb/releases/download/pkg-${commit}/elmdb-0.1.0.tgz`)).toBeUndefined();
    expect(releaseOf(`https://github.com/spankyed/elmdb/releases/download/pkg-${commit.slice(7)}/elmdb-0.1.0.tgz`)).toBeUndefined();
    expect(releaseOf('file:../elmdb/crates/elmdb-node')).toBeUndefined();
  });
});
