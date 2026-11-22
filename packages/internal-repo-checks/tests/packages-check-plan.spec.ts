/**
 * What `npm run packages:check` decides to run (`scripts/lib/packages-check-plan.ts`).
 *
 * **The load-bearing claim is that `attw` never gets a directory.** `attw --pack <dir>` runs `npm pack` inside
 * the tree it is checking and deletes the tarball afterwards, which is a file appearing and vanishing under
 * every other step that reads there — the recorded `ENOENT: open 'publish/apack-ui-0.1.0.tgz'`. Keeping other
 * steps away from it instead was a mutex against 29 of the chain's 30 steps.
 *
 * Asked of the plan rather than of a run, because a run is 2s a tree and 7.8s for all five (measured
 * 2026-10-08) and the step is checked by the chain anyway. What a tarball packed this way does to the tree it
 * came from is `@apackdev/host`'s `published-manifest.spec.ts`, over `packTree` itself.
 */
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishedTreeDirs } from '@apackdev/host/build/packages-built';
import { checksFor, declaresTypes, type PublishedTree } from '../../../scripts/lib/packages-check-plan.ts';

/** A packer a case can recognise the output of, so what reaches `attw` is unambiguous */
const packInto = (dir: string): string => path.join('/tmp/packed', `${path.basename(dir)}.tgz`);

const tree = (pkg: string, manifest: Record<string, unknown>): PublishedTree =>
  ({ pkg, dir: `/repo/packages/${pkg}/publish`, manifest });

const WITH_TYPES = { types: './dist/index.d.ts' };
const TYPES_IN_EXPORTS = { exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } };

describe('what each published tree is asked', () => {
  it('gives both tools the same tarball', () => {
    const checks = checksFor([tree('apack-sdk', WITH_TYPES)], packInto);
    expect(checks.map(({ label }) => label)).toEqual(['publint apack-sdk', 'attw apack-sdk']);
    expect(checks[0]).toMatchObject({ tool: 'publint', args: ['--strict', '/tmp/packed/publish.tgz'] });
    expect(checks[1]).toMatchObject({ tool: 'attw', args: ['/tmp/packed/publish.tgz', '--profile', 'esm-only'] });
  });

  /**
   * The one that matters, stated as its own case because it is the regression this file exists for: an `attw`
   * argument that is a directory is `--pack` by another spelling, whether or not the flag is there.
   */
  it('never hands either tool a path inside the tree it is checking', () => {
    const trees = [tree('apack-testing', WITH_TYPES), tree('apack-sdk', TYPES_IN_EXPORTS), tree('apack-ui', WITH_TYPES)];
    const checks = checksFor(trees, packInto);
    expect(checks).toHaveLength(6);
    for (const { label, args } of checks) {
      const target = args.find((arg) => !arg.startsWith('--') && arg !== 'esm-only');
      expect(target, `${label} names no subject`).toBeDefined();
      expect(target, `${label} is given a tarball`).toMatch(/\.tgz$/);
      expect(trees.some(({ dir }) => target!.startsWith(dir)), `${label} packs inside the tree it checks`).toBe(false);
    }
  });

  it('asks publint alone of a tree that publishes no declarations', () => {
    const checks = checksFor([tree('apack-cli', { bin: { apack: './bin/apack.mjs' } })], packInto);
    expect(checks.map(({ label }) => label)).toEqual(['publint apack-cli']);
    // It still gets a tarball: what attw has nothing to say about is the declarations, not the package
    expect(checks[0]!.args).toEqual(['--strict', '/tmp/packed/publish.tgz']);
  });

  /** One tarball per tree, so the two tools cannot be looking at different bytes of the same tree */
  it('packs each tree once, however many tools read it', () => {
    const packed: string[] = [];
    checksFor([tree('apack-sdk', WITH_TYPES)], (dir) => { packed.push(dir); return packInto(dir); });
    expect(packed).toEqual(['/repo/packages/apack-sdk/publish']);
  });

  it('finds types wherever the manifest puts them', () => {
    expect(declaresTypes(WITH_TYPES)).toBe(true);
    expect(declaresTypes(TYPES_IN_EXPORTS)).toBe(true);
    expect(declaresTypes({ exports: { './fe': { import: { types: './dist/fe.d.ts' } } } }), 'nested conditions').toBe(true);
    expect(declaresTypes({ exports: { '.': './dist/index.js' } })).toBe(false);
    expect(declaresTypes({})).toBe(false);
  });
});

/**
 * **What stops the cases above describing a population that is not the real one.** They are over hand-written
 * manifests, so the derivation they exercise could be right about nothing — and the thing it decides is which
 * of the repo's own trees `attw` sees.
 */
describe('the trees it is asked of', () => {
  it('is every published tree, with attw over the ones that ship declarations', async () => {
    const { readFileSync } = await import('node:fs');
    const trees: PublishedTree[] = Object.entries(publishedTreeDirs()).map(([pkg, dir]) => ({
      pkg, dir, manifest: JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8')) as Record<string, unknown>,
    }));
    expect(trees.map(({ pkg }) => pkg)).toEqual(
      ['apack-sdk', 'apack-ui', 'apack-testing', 'apack-cli']);
    // Three of the four: `@apackdev/cli` publishes a bundle and no declarations
    expect(trees.filter(({ manifest }) => declaresTypes(manifest)).map(({ pkg }) => pkg))
      .toEqual(['apack-sdk', 'apack-ui', 'apack-testing']);
  });
});
