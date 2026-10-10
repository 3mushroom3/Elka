import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

export const PG_USER = "postgres";
export const PG_PASSWORD = "elka";

export function pgUrl(port: number, database: string) {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${port}/${database}`;
}

// Поднимает встроенный PostgreSQL и создаёт базу, если её ещё нет.
export async function startPg(opts: {
  port: number;
  dataDir: string;
  database: string;
  persistent: boolean;
}) {
  const pg = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: opts.port,
    persistent: opts.persistent,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(path.join(opts.dataDir, "PG_VERSION"))) {
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(opts.database);
  } catch {
    // база уже существует
  }
  return pg;
}
