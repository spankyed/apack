import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(packageDir, 'src/agentbuddy-ui/COMPONENT_DEMOS.md');

const manifest = await fs.readFile(manifestPath, 'utf8');
const rows = manifest
  .split('\n')
  .filter(line => line.startsWith('|') && !line.includes('---'))
  .map(line => line.split('|').map(cell => cell.trim()))
  .filter(cells => cells[1] && cells[1] !== 'Composition')
  .map(cells => ({
    composition: stripBackticks(cells[1]),
    output: path.join(packageDir, '..', '..', stripBackticks(cells[2])),
  }));

const serveUrl = await bundle({
  entryPoint: path.join(packageDir, 'src/index.ts'),
  webpackOverride: config => config,
});

for (const row of rows) {
  await fs.mkdir(path.dirname(row.output), {recursive: true});
  const composition = await selectComposition({serveUrl, id: row.composition});
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: row.output,
  });
  console.log(`Rendered ${row.composition} -> ${path.relative(packageDir, row.output)}`);
}

function stripBackticks(value) {
  return value.replace(/^`|`$/g, '');
}
