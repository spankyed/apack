import fs from 'node:fs';
import path from 'node:path';
import { extractPackArchive, isHostCompatible, readPackBuild } from '@apackdev/host/packs';
import { SHIPPED_PACKS_DIRECTORY } from '@apackdev/host/packs/assets';
import { readBuildManifest } from '../build/build-metadata.ts';

export async function stageShippedPack(archive: string, sha256: string, dest: string, hostVersion: string): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(path.dirname(dest), '.shipped-pack-'));
  try {
    const unpacked = await extractPackArchive(archive, scratch, sha256);
    const { snapshot } = readPackBuild(unpacked);
    const { id, hostVersion: range } = snapshot.manifest;
    if (!isHostCompatible(range, hostVersion)) {
      throw new Error(`Pack "${id}" requires apack ${range}; this build is ${hostVersion}`);
    }
    fs.mkdirSync(dest, { recursive: true });
    const target = path.join(dest, id);
    if (fs.existsSync(target)) throw new Error(`Duplicate shipped pack "${id}"`);
    fs.renameSync(unpacked, target);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const root = process.env.APACK_BUILD_ROOT;
  if (!root) throw new Error('Preview starter staging requires an app build session');
  const { version } = readBuildManifest(root);
  const archiveDir = path.join(root, 'pack-archives');
  const archives = fs.readdirSync(archiveDir).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error(`Expected one starter archive in ${archiveDir}`);
  const archive = path.join(archiveDir, archives[0]!);
  const [sha256] = fs.readFileSync(`${archive}.sha256`, 'utf8').trim().split(/\s+/);
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid checksum for ${archive}`);
  await stageShippedPack(archive, sha256, path.join(root, SHIPPED_PACKS_DIRECTORY), version);
}
