import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const manifestPath = path.join(packageDir, 'src/agentbuddy-ui/REVIEW_SNAPSHOTS.md');

const manifest = await fs.readFile(manifestPath, 'utf8');
const rows = manifest
  .split('\n')
  .filter(line => line.startsWith('|') && !line.includes('---'))
  .map(line => line.split('|').map(cell => cell.trim()));

for (const cells of rows) {
  const surface = cells[1] ?? '';
  if (!surface || surface === 'Surface') continue;

  const source = stripBackticks(cells[2] ?? '');
  const timestamp = stripBackticks(cells[3] ?? '');
  const snapshot = stripBackticks(cells[4] ?? '');
  const sourcePath = path.join(repoRoot, source);
  const snapshotPath = path.join(repoRoot, snapshot);

  await fs.mkdir(path.dirname(snapshotPath), {recursive: true});

  const result = spawnSync('ffmpeg', [
    '-y',
    '-ss',
    timestamp,
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-update',
    '1',
    snapshotPath,
  ], {encoding: 'utf8'});

  if (result.status !== 0) {
    throw new Error(`Failed to extract ${surface} snapshot:\n${result.stderr}`);
  }
  console.log(`Extracted ${surface} -> ${snapshot}`);
}

function stripBackticks(value) {
  return value.replace(/^`|`$/g, '');
}
