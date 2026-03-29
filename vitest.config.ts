import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: [
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
      "client/src/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@devbench/shared": path.resolve(import.meta.dirname, "shared/index.ts"),
    },
  },
});
