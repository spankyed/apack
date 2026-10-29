import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { conditions: ["@apackdev/source"] },
  ssr: { resolve: { conditions: ["@apackdev/source"] } },
  test: {
    include: ["tests/engine/sqlite-operations.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
