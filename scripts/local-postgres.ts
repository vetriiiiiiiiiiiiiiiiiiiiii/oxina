/**
 * Local development PostgreSQL (real PostgreSQL 17 binaries via `embedded-postgres`).
 * Development only. Production uses the server's own PostgreSQL 17 install (docs/DEPLOYMENT.md).
 *
 *   npm run db:local            -> starts on port 5433, data in .local/pgdata
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const databaseDir = path.resolve(process.cwd(), ".local/pgdata");
const fresh = !existsSync(path.join(databaseDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "oxina",
  password: "oxina_local_dev",
  port,
  persistent: true,
  onLog: () => {},
});

async function main() {
  if (fresh) await pg.initialise();
  await pg.start();
  for (const db of ["oxina", "oxina_test"]) {
    try {
      await pg.createDatabase(db);
    } catch {
      /* already exists */
    }
  }
  console.log(`Local PostgreSQL running on postgresql://oxina:***@localhost:${port} (databases: oxina, oxina_test). Ctrl+C to stop.`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
