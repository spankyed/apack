import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

const conditions = ['@apackdev/source', ...defaultServerConditions.filter((c) => c !== 'module')];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    /**
     * The native halves as one vitest run, as `vitest.integration.config.ts` pools the integration halves.
     *
     * Written out rather than derived from `NATIVE_SUITES`, for the reason that config gives: `check:specifiers`
     * reads this file as text. `chain-table.spec.ts` asserts it is exactly the suites with a native config.
     */
    projects: [
      'packages/apack-cli/vitest.native.config.ts',
    ],
    // Half the cores, as the integration pool: these scenarios spawn compilers and watchers of their own
    maxWorkers: '50%',
    // One file at a time, as the platform compiler workflows run them: each scenario's compilers, Vite and
    // watchers already use the cores, so two files at once starve each other. On a 3-vCPU runner the relative
    // native-library check takes 14.4s alone (run 39553670513) and passed 60s beside the Electron build case
    fileParallelism: false,
  },
});
