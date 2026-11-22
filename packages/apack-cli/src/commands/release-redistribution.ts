import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const digestPattern = /^[a-f0-9]{64}$/;

interface ReleaseAsset {
  name: string;
  bytes: Buffer;
  contentType: string;
}

export function readRedistributionAssets(directory: string, pack: { id: string; version: string },
  archive: { file: string; sha256: string },
): ReleaseAsset[] {
  const name = 'redistribution.json';
  const bytes = fs.readFileSync(path.join(directory, name));
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.format !== 1 || manifest.pack?.id !== pack.id || manifest.pack?.version !== pack.version
    || manifest.archive?.file !== archive.file || manifest.archive?.sha256 !== archive.sha256
    || !digestPattern.test(manifest.producerLockSha256)
    || !Array.isArray(manifest.files)) {
    throw new Error('Redistribution evidence does not match the verified pack archive');
  }
  const sbom = `${pack.id}-${pack.version}.cdx.json`;
  const expected = new Set(['LICENSE', 'THIRD-PARTY-NOTICES.txt', sbom]);
  const assets: ReleaseAsset[] = [{ name, bytes, contentType: 'application/json' }];
  for (const entry of manifest.files) {
    if (!entry || !expected.delete(entry.file) || !digestPattern.test(entry.sha256)) {
      throw new Error('Redistribution evidence names an unexpected, duplicate or unverified file');
    }
    const contents = fs.readFileSync(path.join(directory, entry.file));
    if (createHash('sha256').update(contents).digest('hex') !== entry.sha256) {
      throw new Error(`Redistribution evidence checksum mismatch for ${entry.file}`);
    }
    assets.push({ name: entry.file, bytes: contents, contentType: entry.file === sbom ? 'application/json' : 'text/plain' });
  }
  if (expected.size) throw new Error(`Missing redistribution evidence: ${[...expected].join(', ')}`);
  return assets;
}
