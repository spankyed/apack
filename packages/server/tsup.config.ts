import { defineConfig } from 'tsup';
import { appBuildOutput, recordBundledPackages } from '../../build/build-metadata.ts';
import { esbuildBundledPackages, installedPackage } from '@apackdev/host/build/bundled-packages';

export default defineConfig((options) => {
  const isDev = options.env?.NODE_ENV === 'development';
  return {
    outDir: appBuildOutput('server'),
    entry: isDev ? ['src/server.ts'] : ['src/types.ts', 'src/server.ts'],
    // **The production build owns this directory; the dev build only adds to it.** Code splitting names
    // chunks by content, so a bundle that stops importing one leaves it behind — and `electron-builder.mjs`
    // ships `packages/**/*`, so what is left behind is shipped. 47 `pack-entry-*.js` chunks were, from when
    // the api still bundled a pack's backend. The dev build must not clean: it emits no declarations, and
    // consumers without the workspace source condition need its compiled type entry.
    clean: !isDev,
    // **What to watch is on the command line, not here, and that is not a preference.** tsup watches a
    // *directory* rather than the module graph, so `@apackdev/host` and `@apackdev/sdk` — both
    // inlined into this bundle by the `@apackdev/source` condition below — have to be named or an edit to one
    // rebuilds nothing: measured 2026-10-10, no rebuild in two and a half minutes. `tests/dev-watch.spec.ts`
    // compares the list with what the bundle reads. Naming them here does not work, because a `--watch` flag
    // *overrides* a `watch` in the config rather than merging with it (measured the same day: the config's
    // paths were ignored). So they live in `build:dev:watch`, which is the one invocation that wants them.
    format: isDev ? ['esm'] : ['esm', 'cjs'],
    dts: !isDev,
    shims: true,
    minify: !isDev,
    // The development app's stacks name source files, which is what the engine's call count attributes calls by
    // (EARS' `calls.ts`, whose own frames are its installed `dist`); the app runs this build with `--enable-source-maps`
    sourcemap: isDev,
    // Beside these, tsup leaves out every package `dependencies` names: `elmdb` and `@elmdb/ears` among them, so the
    // API loads the one EARS installed beside the binding, which the packaged app carries in its node_modules, and the
    // host and the SDK it inlines share it rather than each holding a copy
    external: ['typescript', 'esbuild'],
    // Bundled CommonJS dependencies require Node builtins (yaml requires 'process'); ESM output has no
    // require, so give it one, as the CLI bundle does
    banner: ({ format }) => (format === 'esm'
      ? { js: "import { createRequire as __apackCreateRequire } from 'node:module'; const require = __apackCreateRequire(import.meta.url);" }
      : {}),
    esbuildOptions(esbuildOptions) {
      // Workspace @apackdev/* packages bundle from source (see their package.json exports).
      // Custom conditions replace esbuild's implicit 'module' condition, so keep it.
      esbuildOptions.conditions = ['@apackdev/source', 'module'];
    },
    esbuildPlugins: [
    // What the bundle inlined, for the app's third-party notices (scripts/lib/third-party-notices.ts); the ESM and
    // CJS runs each hand over their list, and the record merges them
    // esbuild is found from tsup, which runs the esbuild it depends on rather than the one installed beside this package
    esbuildBundledPackages(packages => recordBundledPackages('server', packages), { fromDir: installedPackage('tsup', import.meta.dirname).dir }),
    {
      name: 'externalize-vue',
      setup(build) {
        build.onResolve({ filter: /\.vue$/ }, () => ({ path: '__vue_stub__', external: true }));
      },
    },
    ],
  };
});
