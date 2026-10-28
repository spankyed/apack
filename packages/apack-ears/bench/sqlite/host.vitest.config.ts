import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import base from "../../../apack-host/vitest.config.ts";
export default defineConfig({
  ...base,
  resolve: {
    ...base.resolve,
    alias: {
      "@apackdev/ears/lmdb": fileURLToPath(
        new URL("./host-factory.ts", import.meta.url)
      ),
    },
  },
  test: {
    ...base.test,
    include: [
      "tests/database/open-app-database.spec.ts",
      "tests/backup/import.spec.ts",
      "tests/backup/import-transaction.spec.ts",
    ],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
