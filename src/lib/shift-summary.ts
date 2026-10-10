import "server-only";
import type { PaymentMethod } from "@prisma/client";
import { prisma } from "./db";

// Итоги смены по продажам: без отменённых.
export async function shiftSummary(shiftId: number) {
  const items = await prisma.saleItem.findMany({
    where: { sale: { shiftId, cancelStatus: { not: "CANCELLED" } } },
    select: { qty: true, price: true, commission: true, sale: { select: { payment: true } } },
  });
  const byPayment: Record<PaymentMethod, number> = { CASH: 0, TRANSFER: 0, CARD: 0 };
  let qty = 0;
  let revenue = 0;
  let commission = 0;
  for (const item of items) {
    const sum = item.price * item.qty;
    qty += item.qty;
    revenue += sum;
    commission += item.commission;
    byPayment[item.sale.payment] += sum;
  }
  return { qty, revenue, commission, byPayment };
}

// Расхождения пересчётов смены (только строки с разницей).
export function shiftCountDiffs(shiftId: number) {
  return prisma.stockCount.findMany({
    where: { shiftId },
    orderBy: { id: "asc" },
    include: {
      items: {
        where: { diff: { not: 0 } },
        include: { product: { select: { name: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
}
