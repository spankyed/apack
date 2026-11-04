import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PACK_LAYOUT, PACK_LAYOUT_VERSION, type PackIntegrity } from './layout-paths.ts';

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** The receipt's content identity, shared by admission and revisioned asset delivery. */
export function packBuildRevision(integrity: PackIntegrity): string {
  const files = Object.entries(integrity.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return sha256(JSON.stringify({ formatVersion: integrity.formatVersion, files }));
}

/** Serve exactly the requested accepted bytes; never renew a receipt or return a path to read later. */
export function readPackAsset(dir: string, packId: string, revision: string, file: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(revision) || !file || file.includes('\\')
    || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid pack asset request');
  if (fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(path.join(dir, PACK_LAYOUT.integrity)).isFile()) throw new Error('Pack asset receipt is not a regular installed file');
  const integrity = readPackIntegrity(dir);
  if (!integrity || integrity.id !== packId || typeof integrity.formatVersion !== 'number'
    || !Number.isFinite(integrity.formatVersion) || integrity.formatVersion !== PACK_LAYOUT_VERSION
    || !integrity.files || typeof integrity.files !== 'object' || Array.isArray(integrity.files)
    || packBuildRevision(integrity) !== revision) throw new Error(`Pack "${packId}" build changed; reload its frontend`);
  const expected = Object.hasOwn(integrity.files, file) ? integrity.files[file] : undefined;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Pack "${packId}" does not declare asset "${file}"`);
  const root = fs.realpathSync(dir);
  const target = path.join(root, file);
  if (fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error('Pack asset path contains a symbolic link');
  if (!fs.lstatSync(target).isFile()) throw new Error('Pack asset is not a regular file');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('Pack asset is not a regular file');
    const bytes = fs.readFileSync(fd);
    if (sha256(bytes) !== expected) throw new Error(`Pack "${packId}" asset "${file}" changed; rebuild and reinstall the complete pack`);
    return bytes;
  } finally { fs.closeSync(fd); }
}

export function readPackIntegrity(dir: string): PackIntegrity {
  const integrityPath = path.join(dir, PACK_LAYOUT.integrity);
  if (!fs.existsSync(integrityPath)) throw new Error(`Not a pack layout: no ${PACK_LAYOUT.integrity} in ${dir}`);
  return JSON.parse(fs.readFileSync(integrityPath, 'utf-8'));
}

export function sha256File(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

export function listPackFiles(dir: string, base = dir, rejectLinks = false): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (rejectLinks) throw new Error(`Pack contains a symbolic link: ${path.relative(base, full)}`);
      continue;
    }
    if (entry.isDirectory()) out.push(...listPackFiles(full, base, rejectLinks));
    else {
      if (rejectLinks && !entry.isFile()) throw new Error(`Pack contains a nonregular file: ${path.relative(base, full)}`);
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/**
 * The files a pack layout holds and their hashes, which is what `integrity.json` records — and so is
 * excluded from it.
 */
export function packFileHashes(layoutDir: string): Record<string, string> {
  return Object.fromEntries(listPackFiles(layoutDir).filter(rel => rel !== PACK_LAYOUT.integrity)
    .map(rel => [rel, sha256File(path.join(layoutDir, rel))]));
}

/** Check format version and that the files on disk are exactly the ones recorded. */
export function verifyPack(dir: string): PackIntegrity {
  const receipt = fs.lstatSync(path.join(dir, PACK_LAYOUT.integrity), { throwIfNoEntry: false });
  if (!receipt) throw new Error(`Not a pack layout: no ${PACK_LAYOUT.integrity} in ${dir}; rebuild the complete pack`);
  if (receipt.isSymbolicLink()) throw new Error('integrity.json must be a file, not a symbolic link');
  if (!receipt.isFile()) throw new Error('integrity.json must be a regular file');
  const integrity = readPackIntegrity(dir);
  if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)
    || typeof integrity.id !== 'string' || !integrity.id
    || typeof integrity.version !== 'string' || !integrity.version
    || typeof integrity.formatVersion !== 'number' || !Number.isFinite(integrity.formatVersion)
    || !integrity.files || typeof integrity.files !== 'object' || Array.isArray(integrity.files)) {
    throw new Error('Invalid integrity.json: expected layout version, pack id/version and file checksums');
  }
  if (integrity.formatVersion !== PACK_LAYOUT_VERSION) {
    throw new Error(`Pack ${integrity.id} uses format ${integrity.formatVersion}; this host supports format ${PACK_LAYOUT_VERSION}. Update apack or rebuild the pack.`);
  }
  const problems: string[] = [];
  let manifestBytes: Buffer | undefined;
  const onDisk = new Set(listPackFiles(dir, dir, true).filter(f => f !== PACK_LAYOUT.integrity));
  for (const [rel, expected] of Object.entries(integrity.files)) {
    if (!rel || rel.includes('\\') || rel.split('/').some(part => !part || part === '.' || part === '..')
      || rel === PACK_LAYOUT.integrity || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
      problems.push(`invalid checksum entry ${rel}`);
      continue;
    }
    if (!onDisk.has(rel)) problems.push(`missing ${rel}`);
    else {
      const bytes = fs.readFileSync(path.join(dir, rel));
      if (sha256(bytes) !== expected) problems.push(`checksum mismatch ${rel}`);
      if (rel === PACK_LAYOUT.manifest) manifestBytes = bytes;
    }
    onDisk.delete(rel);
  }
  for (const extra of onDisk) problems.push(`unexpected ${extra}`);
  if (problems.length > 0) {
    throw new Error(`Pack ${integrity.id}@${integrity.version} failed verification:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  }
  if (!manifestBytes) throw new Error(`Pack is missing ${PACK_LAYOUT.manifest}`);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (integrity.id !== manifest?.id || integrity.version !== manifest?.version) {
    throw new Error('integrity.json identity does not match its manifest; rebuild and install the complete pack');
  }
  return integrity;
}
