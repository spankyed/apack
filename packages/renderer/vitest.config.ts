import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  // The vite config is a function of its env now, for the dev pack-frontend map. A spec run serves nothing,
  // so it is asked for the build answer: an empty map and no pack source in the graph.
  viteConfig({ command: 'build', mode: 'test' }),
  defineConfig({
    test: {
      // A worker exits when its vitest does, rather than running on orphaned
      setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts'],
      // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts). Declared rather than left to vitest's 5s
      // default, which is *tighter* than the size allows: under the chain's three lanes a 5.8s typecheck in
      // @apackdev/sdk crossed it and reported a hang where the size had headroom to spare.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      environment: 'jsdom',
      // Specs live in tests/, mirroring src/ (tests/source-layout.spec.ts). Both spellings, so a file named
      // *.test.ts isn't silently never run
      include: ['tests/**/*.{spec,test}.?(c|m)[jt]s?(x)'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
