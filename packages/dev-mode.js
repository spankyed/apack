import {build, createServer} from 'vite';
import { spawn } from 'child_process';
import path from 'path';
import { prepareCheckoutProfile } from '../scripts/lib/dev-profile.mjs';

const mode = 'development';
process.env.NODE_ENV = mode;
process.env.MODE = mode;

// Download and stage the distributor's verified pack layouts before the app starts.
await new Promise((resolve, reject) => {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) return reject(new Error('Run the development app with npm run dev'));
  const stage = spawn(process.execPath, [npmCli, 'run', 'packs:stage'], { stdio: 'inherit' });
  stage.once('error', reject);
  stage.once('exit', code => code === 0 ? resolve() : reject(new Error(`Shipped pack staging failed with code ${code}`)));
});

await prepareCheckoutProfile(process.cwd());

// Start the API build and the renderer server concurrently.
// API backend build (skips tsc, single ESM format, no DTS/minify)
const apiBuild = spawn('npm', ['run', 'build:server:dev'], {
  stdio: 'inherit',
  shell: true,
});
const apiBuildDone = new Promise((resolve) => {
  apiBuild.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[dev-mode] API build failed with code ${code}`);
      process.exit(1);
    }
    resolve();
  });
});

// Renderer dev server (other packages depend on its settings)
/** @type {import('vite').ViteDevServer} */
const rendererWatchServer = await createServer({
  mode,
  // Vite binds the next available port when its preferred one is occupied.
  server: { host: '127.0.0.1', strictPort: false },
  root: path.resolve('packages/renderer'),
});
await rendererWatchServer.listen();

// ── 2. Renderer watch server provider surface ──

/** @type {import('vite').Plugin} */
const rendererWatchServerProvider = {
  name: '@app/renderer-watch-server-provider',
  api: {
    provideRendererWatchServer() {
      return rendererWatchServer;
    },
  },
};

// ── 3. Ensure API build is done before Electron spawns ──
await apiBuildDone;

// ── 3b. Then keep it current: a host, SDK or API edit rebuilds, and the app reloads its API ──
//
// Two builds because only the first is a precondition: Electron must not spawn against a missing bundle,
// so that one is awaited and this one runs for as long as the session does. `APACK_DEV_RELOAD` is what
// tells Electron to watch for its writes, since a watcher here could not restart the API — main owns that
// child. The watched paths are in `build:dev:watch`, and `packages/server/tsup.config.ts` says why there.
const apiWatch = spawn('npm', ['run', 'build:dev:watch', '--workspace', '@app/server'], {
  stdio: 'inherit',
  shell: true,
});
process.on('exit', () => apiWatch.kill());
apiWatch.on('exit', (code) => {
  // A dead watcher leaves the loop silently broken: edits stop landing and nothing says so
  if (code) console.error(`[dev-mode] the API watcher exited with code ${code} — backend edits will not reload`);
});
process.env.APACK_DEV_RELOAD = '1';

// ── 4. Build preload and main in parallel ──
/** @type {string[]} */
const packagesToStart = [
  'packages/preload',
  'packages/main',
];

await Promise.all(
  packagesToStart.map(pkg =>
    build({
      mode,
      root: path.resolve(pkg),
      plugins: [rendererWatchServerProvider],
    })
  )
);
