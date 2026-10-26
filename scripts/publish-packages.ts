// Publishes each package's built tree, never a workspace directory: @apackdev/ears, @apackdev/sdk and @apackdev/ui
// from publish/ (a manifest derived from theirs, without the checkout-only @apackdev/source branches) and
// @apackdev/cli and @apackdev/testing from dist/package (a generated manifest). Which tree is which is
// `PUBLISHED_TREES` in @apackdev/host/build/packages-built, where @app/publish-checks reads it too. Run
// `npm run packages:build` first. Versions already on the
// registry are skipped, so re-running after a partial failure is safe. Prints "New tag:" lines,
// which changesets/action turns into git tags and GitHub releases.
//
//   tsx scripts/publish-packages.ts [--dry-run]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { publishedTreeDirs } from '@apackdev/host/build/packages-built';
import { registryDependencies, type Manifest } from '@apackdev/host/build/published-manifest';

const dryRun = process.argv.includes('--dry-run');
const repoRoot = path.resolve(import.meta.dirname, '..');

function isPublished(name: string, version: string): boolean {
  try {
    return execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() === version;
  } catch {
    return false;
  }
}

/** Whether the registry holds a version of `name` that `spec` accepts */
async function onRegistry(name: string, spec: string): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)('npm', ['view', `${name}@${spec}`, 'version', '--json'], { timeout: 60_000 });
    return stdout.trim() !== '';
  } catch {
    return false;
  }
}

// A real publish refuses, before publishing anything, when what it publishes depends on something no registry holds:
// published, it could not be installed. The dry run publishes nothing, so it goes ahead and says what it found
const manifests = Object.values(publishedTreeDirs()).flatMap((dir) => {
  const file = path.join(dir, 'package.json');
  return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, 'utf-8')) as Manifest] : [];
});
const wanted = registryDependencies(manifests);
const asked = [...new Set(wanted.map(({ name, spec }) => `${name}@${spec}`))];
const held = new Set<string>();
// Eight lookups at a time: each is an npm process
for (let at = 0; at < asked.length; at += 8) {
  await Promise.all(asked.slice(at, at + 8).map(async (each) => {
    const split = each.lastIndexOf('@');
    if (await onRegistry(each.slice(0, split), each.slice(split + 1))) held.add(each);
  }));
}
const missing = wanted.filter(({ name, spec }) => !held.has(`${name}@${spec}`));
if (missing.length > 0) {
  const lines = missing.map(({ dependent, name, spec }) => `  ${dependent} depends on ${name}@${spec}`).join('\n');
  const what = `The registry holds no version of what these depend on (a private or unpublished package, such as a linked one):\n${lines}`;
  if (!dryRun) throw new Error(`${what}\nPublish it first, or nothing published here can be installed.`);
  console.warn(`${what}\nA real publish refuses this.`);
}

for (const packageDir of Object.values(publishedTreeDirs())) {
  const manifestPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(path.join(packageDir, 'dist'))) {
    throw new Error(`${path.relative(repoRoot, packageDir)} is not built. Run: npm run packages:build`);
  }
  const { name, version } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (isPublished(name, version)) {
    console.log(`${name}@${version} is already published`);
    continue;
  }
  const args = ['publish', packageDir, '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  else args.push('--provenance');
  execFileSync('npm', args, { stdio: 'inherit' });
  if (!dryRun) console.log(`New tag: ${name}@${version}`);
}
