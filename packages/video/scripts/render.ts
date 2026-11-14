import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compositionId = process.argv[2] ?? 'AgentBuddyFilm';
const output = path.resolve(packageDir, process.argv[3] ?? `out/${compositionId}.mp4`);
const concurrency = process.env.REMOTION_CONCURRENCY
  ? Number(process.env.REMOTION_CONCURRENCY)
  : undefined;

await fs.mkdir(path.dirname(output), {recursive: true});

const serveUrl = await bundle({
  entryPoint: path.join(packageDir, 'src/index.ts'),
  publicDir: path.join(packageDir, 'public'),
  webpackOverride: config => config,
});

try {
  const composition = await selectComposition({serveUrl, id: compositionId});

  await renderMedia({
    composition,
    concurrency,
    serveUrl,
    codec: 'h264',
    outputLocation: output,
  });

  console.log(`Rendered ${compositionId} to ${output}`);
} finally {
  await fs.rm(serveUrl, {recursive: true, force: true});
}
