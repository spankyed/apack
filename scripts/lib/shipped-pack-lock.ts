import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { PACK_ID_PATTERN } from '@apackdev/sdk/ids';
import { sha256File } from '@apackdev/host/packs/assets';
import * as semver from 'semver';

export interface PinnedPackAsset {
  url: string;
  sha256: string;
}

export interface ShippedPackPin {
  id: string;
  version: string;
  archive: PinnedPackAsset;
  redistribution: PinnedPackAsset;
}

const validDigest = /^[a-f0-9]{64}$/;
const validAsset = (asset: unknown): asset is PinnedPackAsset => Boolean(asset && typeof asset === 'object'
  && 'sha256' in asset && typeof asset.sha256 === 'string' && validDigest.test(asset.sha256)
  && 'url' in asset && typeof asset.url === 'string' && URL.canParse(asset.url)
  && new URL(asset.url).protocol === 'https:');

export function readShippedPackLock(file: string): ShippedPackPin[] {
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (lock?.format !== 1 || !Array.isArray(lock.packs)) throw new Error(`Invalid shipped pack lock: ${file}`);
  const ids = new Set<string>();
  for (const entry of lock.packs) {
    if (!entry || typeof entry.id !== 'string' || !PACK_ID_PATTERN.test(entry.id) || ids.has(entry.id)
      || typeof entry.version !== 'string' || semver.valid(entry.version) !== entry.version
      || !validAsset(entry.archive) || !validAsset(entry.redistribution)) {
      throw new Error(`Invalid or duplicate shipped pack pin in ${file}: ${entry?.id ?? '(missing id)'}`);
    }
    ids.add(entry.id);
  }
  return lock.packs;
}

/** Cache verified bytes by digest. An interrupted or corrupt download is never a cache hit. */
export async function preparePinnedAsset({ url, sha256 }: PinnedPackAsset, cache: string, request = fetch): Promise<string> {
  if (!validDigest.test(sha256)) throw new Error('Invalid pinned asset SHA-256');
  fs.mkdirSync(cache, { recursive: true });
  const file = path.join(cache, sha256);
  const matches = (candidate: string) => fs.lstatSync(candidate, { throwIfNoEntry: false })?.isFile() === true
    && sha256File(candidate) === sha256;
  if (matches(file)) return file;
  const scratch = fs.mkdtempSync(path.join(cache, '.download-'));
  try {
    const next = path.join(scratch, 'asset');
    const response = await request(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Could not fetch pinned pack asset (${response.status}): ${url}`);
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), fs.createWriteStream(next));
    if (!matches(next)) throw new Error(`Pinned pack asset checksum mismatch: ${url}`);
    try { fs.renameSync(next, file); }
    catch (error) { if (!matches(file)) throw error; }
    return file;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
