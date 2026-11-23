import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { readPackIntegrity, sha256File } from './assets.ts';
import { PACK_LAYOUT, type PackIntegrity } from './layout-paths.ts';

const SECTIONS = [PACK_LAYOUT.runtimeDir, PACK_LAYOUT.buildDir, PACK_LAYOUT.typesDir] as const;

/** The parts of a complete build that are carried by its exported archive. */
export function stagedFileHashes(integrity: PackIntegrity): Record<string, string> {
  return Object.fromEntries(Object.entries(integrity.files).filter(([file]) =>
    file === PACK_LAYOUT.manifest || (!file.endsWith('.map') && SECTIONS.some(section => file.startsWith(`${section}/`)))));
}

export function packArchiveName(id: string, version: string): string {
  return `${id}-${version}.tgz`;
}

/** Write <outDir>/<id>-<version>.tgz (entries prefixed with <id>/) and its .sha256 file. */
export async function createPackArchive(stageDir: string, outDir: string): Promise<{ file: string; sha256: string; checksumFile: string }> {
  const integrity = readPackIntegrity(stageDir);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, packArchiveName(integrity.id, integrity.version));
  // Reproducible archives: no uid/gid or mtimes
  await tar.create({ gzip: true, file, cwd: stageDir, prefix: integrity.id, portable: true, noMtime: true }, fs.readdirSync(stageDir).sort());
  const sha256 = sha256File(file);
  const checksumFile = `${file}.sha256`;
  fs.writeFileSync(checksumFile, `${sha256}  ${path.basename(file)}\n`);
  return { file, sha256, checksumFile };
}

/** Fail unless `file` hashes to `expected` — the checksum published with an archive, or one the caller knows. */
export function assertChecksum(file: string, expected: string): void {
  const actual = sha256File(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`);
  }
}

/** Extract a pack archive into destDir/<id>/ and return that directory. */
export async function extractPackArchive(archive: string, destDir: string, expectedSha256?: string): Promise<string> {
  if (expectedSha256) assertChecksum(archive, expectedSha256);
  fs.mkdirSync(destDir, { recursive: true });
  await tar.extract({ file: archive, cwd: destDir });
  const dirs = fs.readdirSync(destDir, { withFileTypes: true }).filter(e => e.isDirectory());
  if (dirs.length !== 1) throw new Error(`Pack archive ${path.basename(archive)} must contain exactly one top-level directory`);
  return path.join(destDir, dirs[0].name);
}
