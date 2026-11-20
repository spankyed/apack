import * as fs from 'node:fs';
import * as path from 'node:path';
import { population } from '@apackdev/sdk/testing';
import { describe, expect, it } from 'vitest';
import { publishedTreeDirs, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { PACKAGES_BUILT } from '../src/published-packages';

/**
 * Every published `@apackdev` package carries the repository's LICENSE, whose MIT license its manifest names and asks
 * a copy to carry. npm publishes a package's root `LICENSE` whatever its `files` say, so for the three staged from a
 * package's own directory (`stagePublishTree`) the file is that directory's copy; the two `scripts/bundle-package.ts`
 * builds copy it into `dist/package`. Deleting a copy, or letting one drift from the root's, fails a case below.
 */
const ROOT_LICENSE = fs.readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf8');

/** The packages npm stages from their own directory: their published tree is `publish/` */
const STAGED = Object.entries(publishedTreeDirs()).filter(([, tree]) => path.basename(tree) === 'publish').map(([pkg]) => pkg);

describe('the license of each published package', () => {
  it("is the repository's, in each package staged from its own directory", () => {
    const copies = population('the packages staged from their own directory', STAGED, { atLeast: 2 })
      .map((pkg) => [pkg, path.join(REPO_ROOT, 'packages', pkg, 'LICENSE')] as const);
    expect(copies.filter(([, file]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== ROOT_LICENSE).map(([pkg]) => pkg)).toEqual([]);
  });

  it.skipIf(!PACKAGES_BUILT)("is in every published tree, and is the repository's", () => {
    const trees = population('the published trees', Object.entries(publishedTreeDirs()), { atLeast: 4 });
    const wrong = trees.filter(([, tree]) => {
      const file = path.join(tree, 'LICENSE');
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== ROOT_LICENSE;
    });
    expect(wrong.map(([pkg]) => pkg)).toEqual([]);
  });
});
