import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pgUrl, startPg } from "../scripts/pg";
import { TEST_DATABASE, TEST_PORT } from "./constants";

// Отдельный временный PostgreSQL на время прогона тестов.
export default async function setup() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "elka-test-pg-"));
  const pg = await startPg({
    port: TEST_PORT,
    dataDir,
    database: TEST_DATABASE,
    persistent: false,
  });
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: pgUrl(TEST_PORT, TEST_DATABASE) },
  });

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
