import "server-only";
import { prisma } from "./db";

const API = "https://api.telegram.org";

export function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const response = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Досылает в Telegram уведомления, которые ещё не отправлены.
// Вызывается после действий сотрудников и по расписанию.
export async function flushTelegram() {
  if (!telegramConfigured()) return;
  const baseUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const pending = await prisma.notification.findMany({
    where: {
      telegramSentAt: null,
      // Старое не досылаем: после простоя менеджеру не нужен поток вчерашних сообщений
      createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
      user: { isActive: true, telegramChatId: { not: null } },
    },
    orderBy: { id: "asc" },
    take: 50,
    include: { user: { select: { telegramChatId: true } } },
  });

  for (const n of pending) {
    // Сначала помечаем, потом отправляем: параллельный вызов не продублирует сообщение
    const claimed = await prisma.notification.updateMany({
      where: { id: n.id, telegramSentAt: null },
      data: { telegramSentAt: new Date() },
    });
    if (claimed.count === 0) continue;
    const text = [n.title, n.body, baseUrl && n.link ? baseUrl + n.link : ""]
      .filter(Boolean)
      .join("\n");
    const sent = await sendTelegram(n.user.telegramChatId!, text);
    if (!sent) {
      await prisma.notification.update({ where: { id: n.id }, data: { telegramSentAt: null } });
      // Telegram недоступен: остальное попробуем в следующий раз
      return;
    }
  }
}
