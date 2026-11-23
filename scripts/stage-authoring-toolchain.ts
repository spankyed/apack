import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { bundledPackages } from '@apackdev/host/build/bundled-packages';
import { REPO_ROOT, packagesBuiltOrRefuse, publishedTreeDirs } from '@apackdev/host/build/packages-built';
import { packTree } from '@apackdev/host/build/published-manifest';
import { sha256File } from '@apackdev/host/packs/assets';
import { ACCEPTED, OVERRIDES, noticeOf, noticePackages, renderNotices, type NoticePackage } from './lib/third-party-notices.ts';
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
  const file = 'pack-release-evidence.mjs';
  const evidence = path.join(stage, file);
  const licenseDir = path.join(REPO_ROOT, 'build', 'licenses');
  const texts = Object.fromEntries(fs.readdirSync(licenseDir, { withFileTypes: true }).filter(entry => entry.isFile())
    .map(({ name }) => [name, fs.readFileSync(path.join(licenseDir, name), 'utf8')]));
  const { metafile } = buildSync({
    entryPoints: [path.join(REPO_ROOT, 'scripts', 'pack-release-evidence.ts')],
    absWorkingDir: REPO_ROOT, outfile: evidence, bundle: true, format: 'esm', platform: 'node', target: 'node24',
    metafile: true,
    conditions: ['@apackdev/source'],
    banner: { js: "import { createRequire as __apackCreateRequire } from 'node:module'; const require = __apackCreateRequire(import.meta.url);" },
    define: { __PACK_NOTICE_LICENSES__: JSON.stringify(texts) },
  });
  const modules = Object.values(metafile!.outputs).flatMap(output => Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([name]) => path.resolve(REPO_ROOT, name)));
  const carried = noticePackages([bundledPackages(modules, REPO_ROOT, ['esbuild']).map(pkg => ({ ...pkg, carried: 'inlined' as const }))]);
  const byName = new Map<string, NoticePackage[]>();
  for (const pkg of carried) byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg]);
  // The standalone helper redistributes SPDX data. Keep its CC-BY-3.0 allowance scoped to those
  // two packages and also credit the data in spdx-ranges, whose own LICENSE.md covers the MIT code.
  const overrides = {
    ...OVERRIDES,
    'spdx-exceptions': { files: ['spdx-exceptions-NOTICE'], why: 'npm omits the attribution in the upstream README' },
    'spdx-license-ids': { files: ['spdx-license-ids-NOTICE'], why: 'npm declares CC0-1.0 without including a file' },
  };
  const notices = carried.map(pkg => {
    const carriesSpdxData = pkg.name === 'spdx-exceptions' || pkg.name === 'spdx-ranges';
    const accepted = carriesSpdxData ? [...ACCEPTED, 'CC-BY-3.0'] : ACCEPTED;
    const notice = noticeOf(pkg, licenseDir, byName, overrides, accepted);
    if (typeof notice === 'string') throw new Error(notice);
    if (pkg.name === 'spdx-ranges' && notice.license.includes('CC-BY-3.0')) {
      notice.text += '\n\n' + fs.readFileSync(path.join(licenseDir, 'spdx-ranges-NOTICE'), 'utf8').trim();
    }
    return notice;
  });
  const noticesFile = 'pack-release-evidence.NOTICES.txt';
  const noticesPath = path.join(stage, noticesFile);
  fs.writeFileSync(noticesPath, renderNotices(notices, [], [], file));
  const evidenceTool = { file, sha256: sha256File(evidence), notices: { file: noticesFile, sha256: sha256File(noticesPath) } };
  fs.writeFileSync(path.join(stage, 'toolchain.json'), JSON.stringify({ commit, tag, packages, upstream, evidenceTool }, null, 2) + '\n');
  if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain')) {
    throw new Error('Checkout changed while staging the authoring toolchain');
  }
  packagesBuiltOrRefuse('npm run packages:ensure');
  fs.renameSync(stage, output);
  console.log(output);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
