import { defineConfig } from 'vitest/config';
import { definePackTestConfig } from '@apackdev/testing/vitest';

// Backend tests keep their in-memory runtime and SFC stubs. Frontend tests compile real views in
// jsdom, without importing the backend harness into its browser realm. Both use published packages.
const backend = await definePackTestConfig({ dataDirPrefix: 'default-setup-tests-' });
const frontend = await definePackTestConfig({ dataDirPrefix: 'default-setup-frontend-tests-', vue: true, setupFiles: [] });

export default defineConfig({
  cacheDir: backend.cacheDir,
  test: {
    projects: [
      { ...backend, test: { ...backend.test, name: '@app/default-setup:backend', include: ['tests/**/!(*.frontend).spec.ts'] } },
      { ...frontend, test: { ...frontend.test, name: '@app/default-setup:frontend', environment: 'jsdom', include: ['tests/**/*.frontend.spec.ts'] } },
    ],
  },
});
