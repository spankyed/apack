import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPackArchive, isHostCompatible, readPackBuild } from '@apackdev/host/packs';
import { SHIPPED_PACKS_DIRECTORY } from '@apackdev/host/packs/assets';
import { PACK_REDISTRIBUTION_DIRECTORY, readBuildManifest } from '../build/build-metadata.ts';
import { preparePinnedAsset, readShippedPackLock, type ShippedPackPin } from './lib/shipped-pack-lock.ts';

export async function stageShippedPack(archive: string, sha256: string, dest: string, hostVersion: string, pin?: Pick<ShippedPackPin, 'id' | 'version'>): Promise<string> {
  const scratch = fs.mkdtempSync(path.join(path.dirname(dest), '.shipped-pack-'));
  try {
    const unpacked = await extractPackArchive(archive, scratch, sha256);
    const { snapshot } = readPackBuild(unpacked);
    const { id, version, hostVersion: range } = snapshot.manifest;
    if (pin && (pin.id !== id || pin.version !== version)) {
      throw new Error(`Pin ${pin.id}@${pin.version} resolved to ${id}@${version}`);
    }
    if (!isHostCompatible(range, hostVersion)) {
      throw new Error(`Pack "${id}" requires apack ${range}; this build is ${hostVersion}`);
    }
    fs.mkdirSync(dest, { recursive: true });
    const target = path.join(dest, id);
    if (fs.existsSync(target)) throw new Error(`Duplicate shipped pack "${id}"`);
    fs.renameSync(unpacked, target);
    return id;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const digestPattern = /^[a-f0-9]{64}$/;

/** Download and validate the complete distributor selection before publishing it to this build. */
export async function stagePinnedShippedPacks(
  root: string, hostVersion: string, pins: readonly ShippedPackPin[], cache: string, request = fetch,
): Promise<string[]> {
  const scratch = fs.mkdtempSync(path.join(root, '.shipped-packs-'));
  const layouts = path.join(scratch, SHIPPED_PACKS_DIRECTORY);
  const evidence = path.join(scratch, PACK_REDISTRIBUTION_DIRECTORY);
  fs.mkdirSync(layouts);
  fs.mkdirSync(evidence);
  const versions = new Map(pins.map(pin => [pin.id, pin.version]));
  try {
    for (const pin of pins) {
      const [archive, manifest] = await Promise.all([
        preparePinnedAsset(pin.archive, cache, request),
        preparePinnedAsset(pin.redistribution, cache, request),
      ]);
      await stageShippedPack(archive, pin.archive.sha256, layouts, hostVersion, pin);
      const pack = readPackBuild(path.join(layouts, pin.id)).snapshot.manifest;
      for (const [id, range] of Object.entries(pack.dependencies ?? {})) {
        const version = versions.get(id);
        if (!version || !isHostCompatible(range, version)) {
          throw new Error(`Shipped pack ${pin.id} needs ${id}@${range}; the distributor must select a compatible version`);
        }
      }
      const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (data?.format !== 1 || data.pack?.id !== pin.id || data.pack?.version !== pin.version
        || data.archive?.file !== `${pin.id}-${pin.version}.tgz` || data.archive?.sha256 !== pin.archive.sha256
        || !digestPattern.test(data.producerLockSha256) || !Array.isArray(data.files)) {
        throw new Error(`Redistribution evidence does not match the archive for ${pin.id}`);
      }
      const dir = path.join(evidence, pin.id);
      fs.mkdirSync(dir);
      fs.copyFileSync(manifest, path.join(dir, 'redistribution.json'));
      const expected = new Set(['LICENSE', 'THIRD-PARTY-NOTICES.txt', `${pin.id}-${pin.version}.cdx.json`]);
      for (const entry of data.files) {
        if (!entry || !expected.delete(entry.file) || !digestPattern.test(entry.sha256)) {
          throw new Error(`Unexpected or duplicate notice asset for ${pin.id}`);
        }
        const url = new URL(entry.file, pin.redistribution.url).href;
        const file = await preparePinnedAsset({ url, sha256: entry.sha256 }, cache, request);
        fs.copyFileSync(file, path.join(dir, entry.file));
      }
      if (expected.size) throw new Error(`Missing notice assets for ${pin.id}: ${[...expected].join(', ')}`);
    }
    fs.renameSync(layouts, path.join(root, SHIPPED_PACKS_DIRECTORY));
    fs.renameSync(evidence, path.join(root, PACK_REDISTRIBUTION_DIRECTORY));
    return pins.map(pin => pin.id);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const root = process.env.APACK_BUILD_ROOT;
  if (!root) throw new Error('Starter staging requires an app build session');
  const metadata = readBuildManifest(root);
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const override = process.env.APACK_SHIPPED_PACKS_LOCK;
  const lock = override ? path.resolve(override) : path.join(repo, 'build', 'shipped-packs.lock.json');
  if (override || fs.existsSync(lock)) {
    const shippedPackIds = await stagePinnedShippedPacks(root, metadata.version, readShippedPackLock(lock),
      path.join(repo, '.temp', 'shipped-pack-cache'));
    fs.writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify({ ...metadata, shippedPackIds }, null, 2) + '\n');
  } else {
    if (!process.env.SKIP_DEFAULT_SETUP_BUILD) {
      const npmCli = process.env.npm_execpath;
      if (!npmCli) throw new Error('Run starter staging through npm when compiling the workspace pack');
      execFileSync(process.execPath, [npmCli, 'run', 'build', '-w', '@app/default-setup'], { cwd: repo, stdio: 'inherit' });
    }
    const archiveDir = path.join(root, 'pack-archives');
    execFileSync(process.execPath, [
      '--import', 'tsx', 'packages/apack-cli/scripts/export-built-pack.ts',
      path.join(repo, 'packages', 'default-setup'), archiveDir,
    ], { cwd: repo, stdio: 'inherit' });
    const archives = fs.readdirSync(archiveDir).filter(name => name.endsWith('.tgz'));
    if (archives.length !== 1) throw new Error(`Expected one starter archive in ${archiveDir}`);
    const archive = path.join(archiveDir, archives[0]!);
    const [sha256] = fs.readFileSync(`${archive}.sha256`, 'utf8').trim().split(/\s+/);
    if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid checksum for ${archive}`);
    const id = await stageShippedPack(archive, sha256, path.join(root, SHIPPED_PACKS_DIRECTORY), metadata.version);
    fs.writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify({ ...metadata, shippedPackIds: [id] }, null, 2) + '\n');
  }
}
