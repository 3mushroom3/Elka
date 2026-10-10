import "server-only";
import { checkShiftDeadlines } from "@/domain/deadlines";
import { prisma } from "./db";
import { flushTelegram } from "./telegram";

const INTERVAL_MS = 60_000;
const globalForScheduler = globalThis as unknown as { elkaScheduler?: NodeJS.Timeout };

async function tick() {
  try {
    await prisma.$transaction((tx) => checkShiftDeadlines(tx));
    await flushTelegram();
  } catch (e) {
    console.error("Ошибка фоновой проверки:", e);
  }
}

// Раз в минуту: сроки открытия и закрытия смен, досылка уведомлений в Telegram.
export function startScheduler() {
  if (globalForScheduler.elkaScheduler) return;
  globalForScheduler.elkaScheduler = setInterval(tick, INTERVAL_MS);
  globalForScheduler.elkaScheduler.unref();
}
