import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findPackRoot, readValidManifest, sdkVersion } from '../utils';
import { createPackArchive, stagePack, type PackIntegrity } from '@apackdev/host/packs';
import { readPackBuildInputs, assertPackBuildInputsCurrent } from '@apackdev/host/build/pack-build-inputs';
import { holdPackBuildLock } from '../build/build-lock.ts';

const HELP = `
Usage: apack pack export [--out <dir>]

Export the built pack as an installable <id>-<version>.tgz and write
<id>-<version>.tgz.sha256. Run "apack pack build" first
("apack pack build --release" for publishable output).

Options:
  --out <dir>   Output directory (default: .apack/archives)
`.trim();

export function gitProvenance(root: string): PackIntegrity['provenance'] | undefined {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const commit = git('rev-parse', 'HEAD');
  if (!commit) return undefined;
  // An https remote can carry credentials (https://user:token@host/…); never publish them
  return { commit, repo: git('remote', 'get-url', 'origin')?.replace(/^(\w+:\/\/)[^@/]+@/, '$1') };
}

export interface PackResult {
  file: string;
  sha256: string;
  checksumFile: string;
  integrity: PackIntegrity;
}

export async function buildPackArchive(root: string, outDir = path.join(root, '.apack', 'archives')): Promise<PackResult> {
  // Keep one producer generation through verification, staging and archive publication.
  const lock = await holdPackBuildLock(root, {
    packId: readValidManifest(root).id,
    what: 'apack pack export',
    onWait: (holder) => console.log(`Waiting for ${holder} to finish...`),
  });
  let temporary: string | undefined;
  try {
    const manifest = readValidManifest(root);
    // Archive the selected compiler/options context, not this command's ambient environment.
    const inputs = readPackBuildInputs(path.join(root, 'dist'));
    assertPackBuildInputsCurrent(root, inputs);
    const stageDir = path.join(root, '.apack', 'staged', manifest.id);
    const integrity = stagePack(root, stageDir, { sdkVersion: sdkVersion(), provenance: gitProvenance(root) });
    temporary = fs.mkdtempSync(path.join(root, '.apack', 'archive-'));
    const archive = await createPackArchive(stageDir, temporary);
    assertPackBuildInputsCurrent(root, inputs);
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, path.basename(archive.file));
    const checksumFile = `${file}.sha256`;
    fs.copyFileSync(archive.file, file);
    fs.copyFileSync(archive.checksumFile, checksumFile);
    return { file, checksumFile, sha256: archive.sha256, integrity };
  } finally {
    try { if (temporary) fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 }); }
    finally { lock.release(); }
  }
}

export async function exportPack(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  if (args.length && (args[0] !== '--out' || args.length !== 2 || args[1]!.startsWith('-'))) {
    throw new Error('Usage: apack pack export [--out <dir>]');
  }
  const root = findPackRoot(process.cwd());
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : undefined;

  const result = await buildPackArchive(root, outDir);
  const show = (p: string) => {
    const rel = path.relative(process.cwd(), p);
    return rel.startsWith('..') ? p : rel;
  };
  const sizeKB = (fs.statSync(result.file).size / 1024).toFixed(1);
  const fileCount = Object.keys(result.integrity.files).length;

  console.log(`Packed ${show(result.file)} (${sizeKB} KB, ${fileCount} files)`);
  console.log(`  sha256: ${result.sha256}`);
  console.log(`  checksum: ${show(result.checksumFile)}`);
}
