import { defineConfig } from 'tsup';
import { appBuildOutput } from '../../build/build-metadata.ts';

export default defineConfig((options) => {
  const isDev = options.env?.NODE_ENV === 'development';
  return {
    outDir: appBuildOutput('api'),
    entry: isDev ? ['src/server.ts'] : ['src/types.ts', 'src/server.ts'],
    // **The production build owns this directory; the dev build only adds to it.** Code splitting names
    // chunks by content, so a bundle that stops importing one leaves it behind — and `electron-builder.mjs`
    // ships `packages/**/*`, so what is left behind is shipped. 47 `pack-entry-*.js` chunks were, from when
    // the api still bundled a pack's backend. The dev build must not clean: it emits no declarations, and
    // consumers without the workspace source condition need its compiled type entry.
    clean: !isDev,
    // **What to watch is on the command line, not here, and that is not a preference.** tsup watches a
    // *directory* rather than the module graph, so `@apackdev/host` and `@apackdev/sdk` — both inlined into
    // this bundle by the `@apackdev/source` condition below — have to be named or an edit to either rebuilds
    // nothing: measured 2026-10-10, no rebuild in two and a half minutes. Naming them here does not work,
    // because a `--watch` flag *overrides* a `watch` in the config rather than merging with it (measured
    // the same day: the config's paths were ignored). So they live in `build:dev:watch`, which is the one
    // invocation that wants them.
    format: isDev ? ['esm'] : ['esm', 'cjs'],
    dts: !isDev,
    shims: true,
    minify: !isDev,
    // The development app's stacks name source files, which is what the engine's call count attributes calls by
    // (`@apackdev/ears`'s `calls.ts`); the app runs this build with `--enable-source-maps`
    sourcemap: isDev,
    // Native/vector/WASM loaders must retain the owning EARS package's paths.
    external: ['typescript', 'esbuild', '@apackdev/ears/sqlite'],
    // EARS is also a runtime dependency for the external SQLite entry; keep the shared engine in this bundle.
    noExternal: [/^@apackdev\/ears(?:\/lmdb)?$/],
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
    {
      name: 'externalize-vue',
      setup(build) {
        build.onResolve({ filter: /\.vue$/ }, () => ({ path: '__vue_stub__', external: true }));
      },
    },
    ],
  };
});
