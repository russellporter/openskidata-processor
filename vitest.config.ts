import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Creates the openskidata_test database and enables PostGIS.
    globalSetup: "./src/testSetup.ts",
    // The Jest config set detectOpenHandles, which implies --runInBand. The suite
    // has always run serially as a result, and it relies on that: every test file
    // shares the single openskidata_test database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
