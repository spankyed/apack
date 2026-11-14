import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

// Renders a batch of single-frame stills from the film for visual review.
// Usage: tsx scripts/render-review-stills.ts [frame ...]
// With no arguments it renders a default set covering shot splices,
// dissolves, and chapter-card tails.

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compositionId = process.env.REVIEW_COMPOSITION ?? 'AgentBuddyFilm';
const outDir = path.resolve(packageDir, 'out/review-stills');

const defaultFrames = [
  0, 30, 60, 64, 100, 200, 300, 420, 560, 700, 703, 712, 800, 900, 950, 974,
  1010, 1100, 1250, 1340, 1390, 1480, 1600, 1730, 1820, 1900, 1980, 2080,
  2109, 2150, 2200, 2300, 2390, 2440, 2538,
];

const frames = process.argv.length > 2
  ? process.argv.slice(2).map(Number).filter(Number.isFinite)
  : defaultFrames;

await fs.mkdir(outDir, {recursive: true});

const serveUrl = await bundle({
  entryPoint: path.join(packageDir, 'src/index.ts'),
  publicDir: path.join(packageDir, 'public'),
  webpackOverride: config => config,
});

try {
  const composition = await selectComposition({serveUrl, id: compositionId});

  for (const frame of frames) {
    if (frame < 0 || frame >= composition.durationInFrames) {
      console.warn(`Skipping frame ${frame}: outside 0-${composition.durationInFrames - 1}`);
      continue;
    }
    const output = path.join(outDir, `f${String(frame).padStart(4, '0')}.png`);
    await renderStill({composition, frame, output, serveUrl});
    console.log(`Rendered frame ${frame} -> ${path.relative(packageDir, output)}`);
  }
} finally {
  await fs.rm(serveUrl, {recursive: true, force: true});
}
