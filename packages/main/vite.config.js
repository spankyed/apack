import {getNodeMajorVersion} from '@app/electron-versions';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'child_process';
import electronPath from 'electron';
import {defineConfig, defaultServerConditions} from 'vite';
import {viteStaticCopy} from 'vite-plugin-static-copy';
import {appBuildOutput} from '../../build/build-metadata.ts';

export default defineConfig(({mode}) => /** @type {import('vite').UserConfig} */ ({
  // Bundle SDK and host source into main: packaged builds strip .ts files, so they can't be imported at runtime
  ssr: {
    noExternal: [/^@apackdev\/(sdk|host)/],
    // A native module, loaded where it is installed rather than bundled; linked from the elmdb checkout, which Vite
    // would otherwise read as source
    external: ['elmdb'],
    // Workspace @apackdev/* packages resolve to source (see their package.json exports)
    resolve: {conditions: ['@apackdev/source', ...defaultServerConditions]},
  },
  build: {
    ssr: true,
    sourcemap: mode === 'development' ? 'inline' : false,
    outDir: appBuildOutput('main'),
    assetsDir: '.',
    target: `node${getNodeMajorVersion()}`,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
      },
    },
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  plugins: [
    viteStaticCopy({
      environment: 'ssr', // Required: Vite 7 Environment API defaults to 'client', skipping copies in SSR builds
      targets: [
        {
          src: 'src/modules/splash-screen/assets/*',
          dest: 'assets'
        },
        {
          src: '../../resources/logo.svg',
          dest: 'assets',
          rename: 'logo.svg'
        }
      ]
    }),
    handleHotReload(),
  ],
}));


/**
 * Implement Electron app reload when some file was changed
 * @return {import('vite').Plugin}
 */
function handleHotReload() {

  /** @type {ChildProcess} */
  let electronApp = null;

  /** @type {import('vite').ViteDevServer|null} */
  let rendererWatchServer = null;

  return {
    name: '@app/main-process-hot-reload',

    config(config, env) {
      if (env.mode !== 'development') {
        return;
      }

      const rendererWatchServerProvider = config.plugins.find(p => p.name === '@app/renderer-watch-server-provider');
      if (!rendererWatchServerProvider) {
        throw new Error('Renderer watch server provider not found');
      }

      rendererWatchServer = rendererWatchServerProvider.api.provideRendererWatchServer();

      process.env.VITE_DEV_SERVER_URL = rendererWatchServer.resolvedUrls.local[0];

      return {
        build: {
          watch: {},
        },
      };
    },

    async writeBundle() {
      if (!rendererWatchServer) {
        return;
      }

      /** Kill electron if a process already exists */
      if (electronApp !== null) {
        electronApp.removeListener('exit', process.exit);
        electronApp.kill('SIGINT');
        electronApp = null;
      }

      /** Spawn a new electron process */
      const inspectMode = process.env.ELECTRON_INSPECT === 'true';
      const electronArgs = inspectMode ? ['--inspect=127.0.0.1:0', '.'] : ['.'];

      if (inspectMode) {
        console.log('Starting Electron with Node.js inspector on an available port');
      }

      /**
       * **Which build the app it spawns will resolve, asked the app's own way.**
       *
       * The `NODE_ENV` check above is the *bundle's* mode and says nothing about this: a source run takes its
       * environment from `APACK_ENV` (`_inferElectronAppEnv`, the same function `app-environment.ts` calls), so
       * `APACK_ENV=beta npm run dev` is a beta app. Reading this hook as "development by definition" is what
       * let it push an unauthenticated debug port onto one.
       */
      const { _inferElectronAppEnv, resolveAppEnvironment } = await import('@apackdev/sdk/env');
      const { debugPortArgsFor, publishSession, readDevToolsPort } = await import('@apackdev/host/dev-session');
      const env = _inferElectronAppEnv({
        playwrightTest: process.env.PLAYWRIGHT_TEST === 'true',
        isPackaged: false,
        channel: process.env.APACK_ENV ?? '',
        envVar: process.env.APACK_ENV,
      });

      // The same gate `apack pack dev` passes, through the same function: development only, and nothing else
      electronArgs.push(...debugPortArgsFor(env));

      // Before the spawn, so the port file below is this app's rather than one a previous run left in the
      // data dir — Chromium's `DevToolsActivePort` outlives the browser that wrote it
      const launchedAt = Date.now();
      electronApp = spawn(String(electronPath), electronArgs, {
        stdio: 'inherit',
      });

      /**
       * The session file, so `npm run dev:drive --` can reach the app this loop is holding — which is the half
       * worth having: `apack pack dev` serves a *pack's* frontend, where this one serves the renderer itself,
       * so it is the app you are most often looking at.
       *
       * **The pid is Electron's here, where `apack pack dev` records its own.** The field means "the process to
       * signal to end this", and the direction differs between the two: `dev` is a supervisor whose
       * teardown closes the app, while this watcher exits *with* Electron (the listener below). So in both
       * cases one signal ends the app and the tooling holding it.
       *
       * Fire and forget: the port appears a moment after launch, and a run that never becomes attachable
       * is still a perfectly good dev loop. It is republished on every restart, because each rebuild
       * spawns a new app with a new port.
       */
      const spawned = electronApp;
      void (async () => {
        try {
          // An app with no port is not attachable, and a record with a hole in it is not the honest answer:
          // the file means attachable, so a beta or test run publishes none
          if (debugPortArgsFor(env).length === 0) return;
          // The build this spawn resolves, not a guess: asking with no argument threw here, which published
          // nothing and reported `not attachable` on a run that was otherwise perfectly fine
          const { userDataDir } = resolveAppEnvironment({ env });
          const debugPort = await readDevToolsPort(userDataDir, { after: launchedAt });
          if (spawned !== electronApp) return;  // a rebuild replaced it while the port was being waited for
          // **No fallback to this process's pid.** The field means "the process to signal to end this", and
          // for this launcher that is Electron: the watcher exits *with* it (the listener below), never the
          // other way, so a record naming the watcher would have `profiles stop` end the watcher and leave
          // the app. A spawn with no pid has no app either, so the port above cannot have appeared — this
          // throws rather than publishing a record that names the wrong process.
          if (spawned.pid === undefined) throw new Error('the app was spawned without a pid');
          const unpublish = publishSession({
            host: {kind: 'source', root: realpathSync(fileURLToPath(new URL('../../', import.meta.url)))},
            env: 'development',
            debugPort, dataDir: userDataDir, supervisorPid: spawned.pid, startedBy: 'dev',
          });
          spawned.addListener('exit', unpublish);
        } catch (error) {
          console.warn(`[dev] not attachable: ${error instanceof Error ? error.message : error}`);
        }
      })();

      /** Stops the watch script when the application has been quit */
      electronApp.addListener('exit', process.exit);
    },
  };
}
