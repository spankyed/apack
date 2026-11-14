import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compositionId = process.argv[2] ?? 'AgentBuddyFilm';
const output = path.resolve(packageDir, process.argv[3] ?? `out/${compositionId}.mp4`);

await fs.mkdir(path.dirname(output), {recursive: true});

const serveUrl = await bundle({
  entryPoint: path.join(packageDir, 'src/index.ts'),
  webpackOverride: config => config,
});

const composition = await selectComposition({serveUrl, id: compositionId});

await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: output,
});

console.log(`Rendered ${compositionId} to ${output}`);
