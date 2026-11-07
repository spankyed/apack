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
      setupFiles: ['../apack-testing/src/vitest-exit-with-parent.ts', '../apack-testing/src/vitest-progress-guard.ts'],
      // Small (`SIZE_MS` × `DEADLINE_FACTOR`, scripts/lib/unit-suites.ts): the CPU one test may spend. A test that
      // needs more declares a reviewed `meta.cpuBudgetMs` (`suite-timeouts.spec.ts`)
      provide: { 'apack.testCpuMs': 30_000 },
      // Vitest's clock is off: the progress guard in setupFiles fails a test or hook whose process tree stalls, and a
      // test that spends the CPU budget above (`vitest-progress-guard.ts`, `@apackdev/testing`)
      testTimeout: 0,
      hookTimeout: 0,
      environment: 'jsdom',
      // Specs live in tests/, mirroring src/ (tests/source-layout.spec.ts). Both spellings, so a file named
      // *.test.ts isn't silently never run
      include: ['tests/**/*.{spec,test}.?(c|m)[jt]s?(x)'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
