import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/engine/sqlite-operations.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
