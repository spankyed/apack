import {appBuildOutput, recordBundledPackages} from '../../build/build-metadata.ts';
import {rollupBundledPackages} from '@apackdev/host/build/bundled-packages';
import {getChromeMajorVersion} from '@app/internal-electron-versions';
import {defaultServerConditions, defineConfig} from 'vite';

export default defineConfig(({mode}) => /** @type {import('vite').UserConfig} */ ({
  // Workspace @apackdev/* packages resolve to source, as they do for this package's tsconfig: a config reading
  // a different copy from the typecheck beside it is how a stale dist passes both.
  //
  // No `noExternal` here, unlike main's: the only @apackdev import in this package is `import type`, which
  // esbuild erases, so nothing from the SDK reaches the bundle. A runtime import would need it, because a
  // packaged build strips the .ts files this condition resolves to.
  ssr: {
    resolve: {conditions: ['@apackdev/source', ...defaultServerConditions]},
  },
  build: {
    ssr: true,
    sourcemap: mode === 'development' ? 'inline' : false,
    outDir: appBuildOutput('preload'),
    target: `chrome${getChromeMajorVersion()}`,
    assetsDir: '.',
    lib: {
      entry: ['src/exposed.ts'],
    },
    rollupOptions: {
      output: [
        {
          // ESM preload scripts must have the .mjs extension
          // https://www.electronjs.org/docs/latest/tutorial/esm#esm-preload-scripts-must-have-the-mjs-extension
          entryFileNames: '[name].mjs',
        },
      ],
    },
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  plugins: [
    handleHotReload(),
    // What the bundle inlined, for the app's third-party notices (scripts/lib/third-party-notices.ts)
    rollupBundledPackages(packages => recordBundledPackages('preload', packages), {fromDir: import.meta.dirname}),
  ],
}));


/**
 * Implement Electron webview reload when some file was changed
 * @return {import('vite').Plugin}
 */
function handleHotReload() {
  /** @type {import('vite').ViteDevServer|null} */
  let rendererWatchServer = null;

  return {
    name: '@app/preload-process-hot-reload',

    config(config, env) {
      if (env.mode !== 'development') {
        return;
      }

      const rendererWatchServerProvider = config.plugins.find(p => p.name === '@app/renderer-watch-server-provider');
      if (!rendererWatchServerProvider) {
        throw new Error('Renderer watch server provider not found');
      }

      rendererWatchServer = rendererWatchServerProvider.api.provideRendererWatchServer();

      return {
        build: {
          watch: {},
        },
      };
    },

    writeBundle() {
      if (!rendererWatchServer) {
        return;
      }

      rendererWatchServer.ws.send({
        type: 'full-reload',
      });
    },
  };
}
