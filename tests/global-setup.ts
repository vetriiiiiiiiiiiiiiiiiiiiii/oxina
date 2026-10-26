import { execSync } from "node:child_process";

/** Apply migrations to the dedicated test database once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? readEnv("TEST_DATABASE_URL");
  if (!url || !/test/i.test(new URL(url).pathname)) throw new Error("Refusing to migrate: TEST_DATABASE_URL must name a *test* database.");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}

function readEnv(key: string) {
  const fs = require("node:fs") as typeof import("node:fs");
  const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
  return m?.[1];
}
