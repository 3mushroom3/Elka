import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { telegramConfigured } from "@/lib/telegram";
import { markNotificationsReadAction, saveTelegramAction } from "../actions";

export default async function NotificationsPage() {
  const user = await requireRole("MANAGER");
  const [notifications, me] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { id: "desc" },
      take: 100,
    }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
  ]);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Уведомления"
        hint="Всё, что произошло и требует вашего внимания."
      />

      <section className="card mb-6">
        {unread > 0 && (
          <ActionForm
            action={markNotificationsReadAction}
            submitLabel={`Отметить прочитанными (${unread})`}
            className="mb-4"
          >
            {null}
          </ActionForm>
        )}
        {notifications.length === 0 && (
          <p className="text-sm text-zinc-500">Уведомлений пока нет.</p>
        )}
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`border-b border-zinc-100 py-2 last:border-0 ${n.readAt ? "text-zinc-500" : ""}`}
          >
            <p className="flex justify-between gap-3">
              <span className={n.readAt ? "" : "font-semibold"}>
                {!n.readAt && <span className="mr-2 text-red-600">●</span>}
                {n.link ? (
                  <Link href={n.link} className="underline decoration-zinc-300">
                    {n.title}
                  </Link>
                ) : (
                  n.title
                )}
              </span>
              <span className="text-sm whitespace-nowrap text-zinc-500">
                {formatDateTime(n.createdAt)}
              </span>
            </p>
            {n.body && <p className="text-sm">{n.body}</p>}
          </div>
        ))}
      </section>

      <section className="card max-w-xl">
        <h2 className="h2">Уведомления в Telegram</h2>
        <ol className="mb-3 list-decimal pl-5 text-sm text-zinc-600">
          <li>Откройте в Telegram бота вашей системы и нажмите «Запустить».</li>
          <li>
            Узнайте свой числовой ID: напишите боту @userinfobot, он пришлёт его
            в ответ.
          </li>
          <li>Введите ID ниже и сохраните. Придёт проверочное сообщение.</li>
        </ol>
        {!telegramConfigured() && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            На сервере не задан токен бота (TELEGRAM_BOT_TOKEN), поэтому
            сообщения пока не отправляются. Уведомления внутри системы работают.
          </p>
        )}
        <ActionForm action={saveTelegramAction} submitLabel="Сохранить">
          <label className="label">Мой ID в Telegram (пусто: отключить)</label>
          <input
            name="chatId"
            defaultValue={me.telegramChatId ?? ""}
            inputMode="numeric"
            className="input"
          />
        </ActionForm>
      </section>
    </>
  );
}
