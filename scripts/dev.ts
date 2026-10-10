// Локальный запуск: встроенный PostgreSQL + миграции + next dev.
// Использование: npm run dev | npm run db (только база)
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { startPg, pgUrl } from "./pg";

// Порт и папку базы можно переопределить, чтобы поднять отдельный стенд для проверок
const PORT = Number(process.env.ELKA_PG_PORT ?? 54329);
const DATABASE = "elka";
const dbOnly = process.argv.includes("--db-only");

async function main() {
  const pg = await startPg({
    port: PORT,
    dataDir: path.resolve(process.env.ELKA_PG_DIR ?? ".pgdata"),
    database: DATABASE,
    persistent: true,
  });
  process.env.DATABASE_URL = pgUrl(PORT, DATABASE);
  console.log(`PostgreSQL запущен: ${process.env.DATABASE_URL}`);

  const stop = async () => {
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (dbOnly) return;

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
  // Создаёт менеджера и справочник видов, если их ещё нет
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });
  const next = spawn("npx", ["next", "dev"], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  next.on("exit", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
