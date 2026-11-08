import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildPackArchive, type PackResult } from '../../src/commands/archive';
import { extractPackArchive, verifyPack } from '@apackdev/host/packs';

let output: string;
let archive: PackResult;

// Use the same archive-operation allowance as the fork producer. Extraction/verification keep
// their separate ordinary test deadline; neither phase borrows time from cleanup.
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../default-setup/', import.meta.url));
  output = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-default-archive-'));
  archive = await buildPackArchive(root, output);
});

afterAll(() => { if (output) fs.rmSync(output, { recursive: true, force: true }); });

// Exercises the real built pack's complete input replay, staging and compressed archive.
it('archives the real default-setup build as a verified pack without a manifest privilege', async () => {
  const extracted = await extractPackArchive(archive.file, path.join(output, 'extracted'));
  const integrity = verifyPack(extracted);
  expect(integrity.id).toBe('default-setup');
  expect(fs.readFileSync(archive.checksumFile, 'utf8')).toContain(archive.sha256);
  const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'apack.json'), 'utf8'));
  expect(manifest.id).toBe('default-setup');
  expect(manifest).not.toHaveProperty('builtIn');
});
