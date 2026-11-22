import fs from 'node:fs';
import path from 'node:path';
import { SHIPPED_PACKS_DIRECTORY } from '@apackdev/host/packs/assets';
import { APP_WORKSPACES, bundledPackagesFile, sealBuildSession } from '../../../../build/build-metadata.ts';

/** Stand-ins for successful bundler output, each bundler's record of what it inlined included, using the real build receipt. */
export function completeBuildFixture(root: string): void {
  for (const workspace of APP_WORKSPACES) {
    const dist = path.join(root, 'packages', workspace, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.js'), workspace);
    fs.mkdirSync(path.dirname(bundledPackagesFile(root, workspace)), { recursive: true });
    fs.writeFileSync(bundledPackagesFile(root, workspace), JSON.stringify({ packages: [] }));
  }
  fs.mkdirSync(path.join(root, SHIPPED_PACKS_DIRECTORY), { recursive: true });
  sealBuildSession(root);
}
