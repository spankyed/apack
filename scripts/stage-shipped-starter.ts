import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPackArchive, isHostCompatible, readPackBuild } from '@apackdev/host/packs';
import { CHECKOUT_DISTRIBUTION_DIRECTORY, SHIPPED_PACKS_DIRECTORY, SHIPPED_PACKS_LOCK_FILE, sha256File } from '@apackdev/host/packs/assets';
import { replaceDir } from '@apackdev/host/replace-dir';
import { PACK_REDISTRIBUTION_DIRECTORY, readBuildManifest, resolveBuildMetadata } from '../build/build-metadata.ts';
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
      const { snapshot: { manifest: pack }, integrity } = readPackBuild(path.join(layouts, pin.id));
      for (const [id, range] of Object.entries(pack.dependencies ?? {})) {
        const version = versions.get(id);
        if (!version || !isHostCompatible(range, version)) {
          throw new Error(`Shipped pack ${pin.id} needs ${id}@${range}; the distributor must select a compatible version`);
        }
      }
      const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (data?.format !== 1 || data.pack?.id !== pin.id || data.pack?.version !== pin.version
        || data.archive?.file !== `${pin.id}-${pin.version}.tgz` || data.archive?.sha256 !== pin.archive.sha256
        || !digestPattern.test(data.producerLockSha256) || data.producerLockSha256 !== integrity.releaseEvidence?.lockSha256
        || !Array.isArray(data.files)) {
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

const repo = fileURLToPath(new URL('..', import.meta.url));
const cache = path.join(repo, '.temp', 'shipped-pack-cache');

function selectedLock(): string {
  const override = process.env.APACK_SHIPPED_PACKS_LOCK;
  return override ? path.resolve(override) : path.join(repo, SHIPPED_PACKS_LOCK_FILE);
}

/** Prepare the same distribution for local launches and pack dependency resolution. */
async function stageCheckoutShippedPacks(): Promise<void> {
  const dest = path.join(repo, CHECKOUT_DISTRIBUTION_DIRECTORY);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(dest), '.shipped-distribution-'));
  try {
    const metadata = resolveBuildMetadata({});
    const lock = selectedLock();
    const lockSha256 = sha256File(lock);
    const shippedPackIds = await stagePinnedShippedPacks(staging, metadata.version, readShippedPackLock(lock), cache);
    if (sha256File(lock) !== lockSha256) throw new Error('The distribution lock changed during staging');
    fs.writeFileSync(path.join(staging, 'build-manifest.json'), JSON.stringify({ version: metadata.version, shippedPackIds, lockSha256 }, null, 2) + '\n');
    replaceDir(staging, dest);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const checkout = process.argv.slice(2);
  if (checkout.length === 1 && checkout[0] === '--checkout') {
    await stageCheckoutShippedPacks();
  } else if (!checkout.length) await stagePackagedShippedPacks();
  else throw new Error('Usage: tsx scripts/stage-shipped-starter.ts [--checkout]');
}

async function stagePackagedShippedPacks(): Promise<void> {
  const root = process.env.APACK_BUILD_ROOT;
  if (!root) throw new Error('Starter staging requires an app build session');
  const metadata = readBuildManifest(root);
  const shippedPackIds = await stagePinnedShippedPacks(root, metadata.version, readShippedPackLock(selectedLock()), cache);
  fs.writeFileSync(path.join(root, 'build-manifest.json'), JSON.stringify({ ...metadata, shippedPackIds }, null, 2) + '\n');
}
