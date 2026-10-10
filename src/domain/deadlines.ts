import type { Tx } from "@/lib/db";
import { dayStart } from "@/lib/labels";
import { createIncident } from "./incidents";

const MSK_OFFSET_MIN = 3 * 60;

// Минуты от начала суток по московскому времени
function minutesOfDay(now: Date) {
  return (Math.floor(now.getTime() / 60000) + MSK_OFFSET_MIN) % (24 * 60);
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Проверка сроков смен. Запускается по расписанию; каждое нарушение
// фиксируется один раз (на точку в сутки или на смену).
export async function checkShiftDeadlines(tx: Tx, now: Date = new Date()) {
  const today = dayStart(now);
  const minute = minutesOfDay(now);
  // Точки без назначенных продавцов не проверяем: там некому открывать смену
  const points = await tx.point.findMany({
    where: { isActive: true, sellers: { some: { user: { isActive: true } } } },
  });
  let created = 0;

  for (const point of points) {
    const open = await tx.shift.findFirst({
      where: { pointId: point.id, status: { not: "CLOSED" } },
      include: { seller: { select: { fullName: true } } },
    });

    if (!open && minute >= toMinutes(point.openDeadline)) {
      const openedToday = await tx.shift.count({
        where: { pointId: point.id, openedAt: { gte: today } },
      });
      const reported = await tx.incident.count({
        where: { type: "SHIFT_NOT_OPENED", pointId: point.id, createdAt: { gte: today } },
      });
      if (openedToday === 0 && reported === 0) {
        await createIncident(tx, {
          type: "SHIFT_NOT_OPENED",
          pointId: point.id,
          description: `${point.name}: смена не открыта к ${point.openDeadline}`,
        });
        created++;
      }
    }

    // Смена, открытая в прошлые сутки, просрочена в любом случае
    const overdue =
      open && (open.openedAt < today || minute >= toMinutes(point.closeDeadline));
    if (open && overdue) {
      const reported = await tx.incident.count({
        where: { type: "SHIFT_NOT_CLOSED", shiftId: open.id },
      });
      if (reported === 0) {
        await createIncident(tx, {
          type: "SHIFT_NOT_CLOSED",
          pointId: point.id,
          shiftId: open.id,
          userId: open.sellerId,
          description: `${point.name}: смена продавца ${open.seller.fullName} не закрыта к ${point.closeDeadline}`,
        });
        created++;
      }
    }
  }
  return created;
}
