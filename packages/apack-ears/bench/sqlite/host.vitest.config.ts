// Run from packages/apack-host. Keep this evaluation config independent of the host's config so
// EARS typechecking does not gain an upward workspace dependency just to exercise its backend alias.
import { defineConfig } from "vitest/config";
import { defaultServerConditions } from "vite";
import { fileURLToPath } from "node:url";
const conditions = [
  "@apackdev/source",
  ...defaultServerConditions.filter((c) => c !== "module"),
];
export default defineConfig({
  resolve: {
    conditions,
    alias: {
      "@apackdev/ears/lmdb": fileURLToPath(
        new URL("./host-factory.ts", import.meta.url)
      ),
    },
  },
  ssr: { resolve: { conditions } },
  test: {
    setupFiles: ["../apack-testing/src/vitest-exit-with-parent.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      "tests/database/open-app-database.spec.ts",
      "tests/backup/import.spec.ts",
      "tests/backup/import-transaction.spec.ts",
    ],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
