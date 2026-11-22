import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, packagesBuiltOrRefuse, publishedTreeDirs } from '@apackdev/host/build/packages-built';
import { packTree } from '@apackdev/host/build/published-manifest';
import { sha256File } from '@apackdev/host/packs/assets';
import { REPOSITORIES, releaseOf, repositoryOf } from './lib/external-packages.mjs';

const [destination, ...extra] = process.argv.slice(2);
if (!destination || extra.length) throw new Error('Usage: npm run packages:stage-toolchain -- <output-parent>');

const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Stage an authoring toolchain from a clean checkout');
const commit = git('rev-parse', 'HEAD');
const { overrides } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { overrides: Record<string, string> };
const upstream = Object.fromEntries(Object.values(REPOSITORIES).flatMap(({ packages }) => Object.keys(packages)).map(name => {
  const source = overrides[name];
  if (!source || releaseOf(source)?.repo !== repositoryOf(name)) throw new Error(`Authoring toolchain needs a release pin for ${name}`);
  return [name, source];
}));

packagesBuiltOrRefuse('npm run packages:ensure');

const tag = `toolchain-${commit}`;
const parent = path.resolve(destination);
const output = path.join(parent, tag);
fs.mkdirSync(parent, { recursive: true });
if (fs.existsSync(output)) throw new Error(`Toolchain output already exists: ${output}`);

const stage = fs.mkdtempSync(path.join(parent, '.toolchain-'));
try {
  const packages = Object.fromEntries(Object.values(publishedTreeDirs()).map(dir => {
    const { name, version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name: string; version: string };
    const tarball = packTree(dir, stage);
    return [name, { version, file: path.basename(tarball), sha256: sha256File(tarball) }];
  }));
  fs.writeFileSync(path.join(stage, 'toolchain.json'), JSON.stringify({ commit, tag, packages, upstream }, null, 2) + '\n');
  if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain')) {
    throw new Error('Checkout changed while staging the authoring toolchain');
  }
  packagesBuiltOrRefuse('npm run packages:ensure');
  fs.renameSync(stage, output);
  console.log(output);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
