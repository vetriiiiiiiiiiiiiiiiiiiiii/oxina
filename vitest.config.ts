import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Load .env without extra dependencies, then force the TEST database for every test process.
const env: Record<string, string> = {};
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
}
const testUrl = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
if (!testUrl || !/test/i.test(new URL(testUrl).pathname)) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name contains 'test'. Tests wipe that database.");
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      ...env,
      DATABASE_URL: testUrl,
      NODE_ENV: "test",
      FILE_SIGNING_SECRET: env.FILE_SIGNING_SECRET || "test-signing-secret-test-signing-secret-0000",
      DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64"),
      LOCAL_UPLOAD_DIR: "./.local/test-uploads",
    },
  },
});
