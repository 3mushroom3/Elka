import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

export const PG_USER = "postgres";
export const PG_PASSWORD = "elka";

export function pgUrl(port: number, database: string) {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${port}/${database}`;
}

function portOpen(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
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
  try {
    await pg.start();
  } catch (e) {
    // База могла остаться запущенной от прошлого сеанса: тогда просто работаем с ней
    if (!(await portOpen(opts.port))) {
      throw new Error(`PostgreSQL не запустился (порт ${opts.port}, папка ${opts.dataDir})`, {
        cause: e,
      });
    }
    console.log(`PostgreSQL уже запущен на порту ${opts.port}, используем его`);
  }
  try {
    await pg.createDatabase(opts.database);
  } catch {
    // база уже существует
  }
  return pg;
}
