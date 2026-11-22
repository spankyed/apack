import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { extractPackArchive, packArchiveName, stagedFileHashes } from '@apackdev/host/packs/archive-files';
import { sha256File, verifyPack } from '@apackdev/host/packs/assets';
import { readPackBundledPackages } from '@apackdev/host/build/bundled-packages';
import { appSbom, downloadedBinaries, noticeOf, noticePackages, renderNotices, sbomIdentity, staleExtras, type NoticePackage } from './lib/third-party-notices.ts';

// stage-authoring-toolchain embeds the release's license overrides in this independently runnable tool.
declare const __PACK_NOTICE_LICENSES__: Record<string, string>;

const [rootArg, outArg, ...extra] = process.argv.slice(2);
if (!rootArg || !outArg || extra.length) throw new Error('Usage: node pack-release-evidence.mjs <pack-root> <release-directory>');
const root = path.resolve(rootArg);
const out = path.resolve(outArg);
const integrity = verifyPack(path.join(root, 'dist'));
const { id, version } = integrity;
const archiveFile = packArchiveName(id, version);
const archive = path.join(out, archiveFile);
const sha256 = sha256File(archive);
const [declared] = fs.readFileSync(`${archive}.sha256`, 'utf8').trim().split(/\s+/);
if (declared !== sha256) throw new Error('The archive checksum does not match');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-pack-evidence-'));
try {
  const layout = await extractPackArchive(archive, path.join(scratch, 'archive'), sha256);
  if (!isDeepStrictEqual(verifyPack(layout).files, stagedFileHashes(integrity))) {
    throw new Error('The archive and the producer build differ');
  }
  const licenses = path.join(scratch, 'licenses');
  fs.mkdirSync(licenses);
  for (const [name, text] of Object.entries(__PACK_NOTICE_LICENSES__)) {
    fs.writeFileSync(path.join(licenses, name), text);
  }
  const observed = readPackBundledPackages(root);
  const packages = noticePackages([observed.packages.map(pkg => ({ ...pkg, carried: 'inlined' as const }))]);
  const identity = sbomIdentity(root);
  const problems = [...observed.problems, ...staleExtras(packages)];
  const byName = new Map<string, NoticePackage[]>();
  for (const pkg of packages) {
    if (!identity.integrity.has(`${pkg.name}@${pkg.version}`)) problems.push(`Missing locked integrity for ${pkg.name}@${pkg.version}`);
    byName.set(pkg.name, [...byName.get(pkg.name) ?? [], pkg]);
  }
  const notices = packages.flatMap(pkg => {
    const notice = noticeOf(pkg, licenses, byName);
    if (typeof notice !== 'string') return [notice];
    problems.push(notice);
    return [];
  });
  if (problems.length) throw new Error(`Incomplete pack notices:\n${problems.join('\n')}`);

  const noticeFile = 'THIRD-PARTY-NOTICES.txt';
  const sbomFile = `${id}-${version}.cdx.json`;
  const sourceCredits = ['NOTICE', ...(fs.existsSync(path.join(root, 'licenses'))
    ? fs.readdirSync(path.join(root, 'licenses'), { withFileTypes: true })
      .filter(file => file.isFile()).map(file => `licenses/${file.name}`).sort()
    : [])].filter(file => fs.existsSync(path.join(root, file)))
    .map(file => `\n${file}\n${fs.readFileSync(path.join(root, file), 'utf8').trim()}\n`);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
  fs.writeFileSync(path.join(out, noticeFile), renderNotices(notices, [], [], id) + sourceCredits.join(''));
  const writeJson = (name: string, data: object) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n');
  writeJson(sbomFile, appSbom({ name: id, version }, packages, identity, downloadedBinaries(packages)));
  writeJson('redistribution.json', {
    format: 1,
    pack: { id, version },
    archive: { file: archiveFile, sha256 },
    producerLockSha256: sha256File(path.join(root, 'package-lock.json')),
    files: ['LICENSE', noticeFile, sbomFile].map(file => ({ file, sha256: sha256File(path.join(out, file)) })),
  });
  console.log(`Verified redistribution evidence for ${id}@${version} (${packages.length} components)`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
