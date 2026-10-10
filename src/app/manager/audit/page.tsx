import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";

const ACTION_LABEL: Record<string, string> = {
  login: "Вход",
  "login.failed": "Неудачная попытка входа",
  logout: "Выход",
  "user.create": "Создан сотрудник",
  "user.update": "Изменён сотрудник",
  "point.create": "Создана точка",
  "point.update": "Изменена точка",
  "product.create": "Добавлен вид товара",
  "product.update": "Изменён вид товара",
  "receipt.create": "Приход на склад",
  "warehouse.inventory": "Инвентаризация склада",
  "movement.correction": "Корректировка",
  "request.create": "Создана заявка",
  "request.approve": "Заявка утверждена",
  "request.reject": "Заявка отклонена",
  "trip.cancel": "Рейс отменён",
  "trip.load": "Загрузка рейса",
  "trip.depart": "Выезд по рейсу",
  "trip.unload": "Выгрузка рейса",
  "trip.accept": "Приём рейса на точке",
  "driver.return": "Возврат от водителя на склад",
  "incident.resolve": "Инцидент закрыт",
  "shift.open": "Смена открыта (утренний пересчёт)",
  "shift.count": "Вечерний пересчёт",
  "shift.close": "Смена закрыта (сдача денег)",
  "shift.cash": "Наличные получены менеджером",
  "shift.stickers": "Стикеры сверены",
  "sale.create": "Продажа",
  "user.telegram": "Настройка Telegram",
  "writeoff.create": "Запрос на списание",
  "writeoff.approve": "Списание одобрено",
  "writeoff.reject": "В списании отказано",
  "sale.cancel_request": "Запрос отмены продажи",
  "sale.cancel_approve": "Продажа отменена",
  "sale.cancel_reject": "В отмене продажи отказано",
};

export default async function AuditPage() {
  await requireRole("MANAGER");
  const entries = await prisma.auditLog.findMany({
    orderBy: { id: "desc" },
    take: 300,
    include: { user: { select: { fullName: true } } },
  });

  return (
    <>
      <h1 className="h1">Журнал действий</h1>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Кто</th>
              <th>Действие</th>
              <th>Подробности</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                <td className="whitespace-nowrap">{e.user?.fullName ?? ""}</td>
                <td className="whitespace-nowrap">
                  {ACTION_LABEL[e.action] ?? e.action}
                  {e.entityId ? ` №${e.entityId}` : ""}
                </td>
                <td className="font-mono text-xs break-all text-zinc-500">
                  {e.payload ? JSON.stringify(e.payload) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-zinc-500">Показаны последние 300 записей.</p>
      </section>
    </>
  );
}
