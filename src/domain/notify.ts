import type { Tx } from "@/lib/db";
import { getBalances } from "./ledger";

// Уведомление всем действующим менеджерам. Создаётся в той же транзакции,
// что и событие: если событие не сохранилось, уведомления тоже не будет.
// В Telegram оно уходит позже, отдельной отправкой.
export async function notifyManagers(
  tx: Tx,
  input: { type: string; title: string; body?: string; link?: string },
) {
  const managers = await tx.user.findMany({
    where: { role: "MANAGER", isActive: true },
    select: { id: true },
  });
  if (managers.length === 0) return;
  await tx.notification.createMany({
    data: managers.map((m) => ({
      userId: m.id,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      link: input.link ?? "",
    })),
  });
}

// Сигнал о низком остатке: один раз, в момент, когда остаток точки
// опустился до порога (а не при каждой следующей продаже).
export async function notifyLowStock(tx: Tx, pointId: number, removedQty: number) {
  const point = await tx.point.findUniqueOrThrow({
    where: { id: pointId },
    include: { location: true },
  });
  const balances = await getBalances(tx, point.location!.id);
  const after = [...balances.values()].reduce((a, b) => a + b, 0);
  const before = after + removedQty;
  if (before > point.lowStockThreshold && after <= point.lowStockThreshold) {
    await notifyManagers(tx, {
      type: "LOW_STOCK",
      title: `Низкий остаток: ${point.name}`,
      body: `На точке осталось ${after} шт. (порог ${point.lowStockThreshold})`,
      link: "/manager/requests#new",
    });
  }
}
