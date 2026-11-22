import { resolve } from 'node:path';
import { buildPackArchive } from '../src/commands/archive.ts';

const [packRoot, outDir, ...extra] = process.argv.slice(2);
if (!packRoot || !outDir || extra.length) {
  throw new Error('Usage: tsx packages/apack-cli/scripts/export-built-pack.ts <pack-root> <output-dir>');
}

const { file, sha256 } = await buildPackArchive(resolve(packRoot), resolve(outDir));
console.log(`Exported ${file}\n  sha256: ${sha256}`);
