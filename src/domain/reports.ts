import type { Tx } from "@/lib/db";
import { dayStart } from "@/lib/labels";

export type ReportRow = { key: string; label: string; qty: number; revenue: number; commission: number };

export type SalesReport = {
  total: Omit<ReportRow, "key" | "label">;
  byPoint: ReportRow[];
  bySeller: ReportRow[];
  byDay: ReportRow[];
  byProduct: ReportRow[];
};

const dayLabel = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// Выручка, количество и начисленный продавцам процент за период
// в разрезе точки, продавца, дня и вида. Отменённые продажи не учитываются.
export async function salesReport(
  tx: Tx,
  period: { from?: Date; to?: Date },
): Promise<SalesReport> {
  const items = await tx.saleItem.findMany({
    where: {
      sale: {
        cancelStatus: { not: "CANCELLED" },
        createdAt: { gte: period.from, lt: period.to },
      },
    },
    select: {
      qty: true,
      price: true,
      commission: true,
      product: { select: { id: true, name: true, sortOrder: true } },
      sale: {
        select: {
          createdAt: true,
          point: { select: { id: true, name: true } },
          seller: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  const groups = {
    byPoint: new Map<string, ReportRow>(),
    bySeller: new Map<string, ReportRow>(),
    byDay: new Map<string, ReportRow>(),
    byProduct: new Map<string, ReportRow>(),
  };
  const total = { qty: 0, revenue: 0, commission: 0 };
  const add = (map: Map<string, ReportRow>, key: string, label: string, i: (typeof items)[0]) => {
    const row = map.get(key) ?? { key, label, qty: 0, revenue: 0, commission: 0 };
    row.qty += i.qty;
    row.revenue += i.qty * i.price;
    row.commission += i.commission;
    map.set(key, row);
  };

  for (const i of items) {
    total.qty += i.qty;
    total.revenue += i.qty * i.price;
    total.commission += i.commission;
    const day = dayStart(i.sale.createdAt);
    add(groups.byPoint, String(i.sale.point.id), i.sale.point.name, i);
    add(groups.bySeller, String(i.sale.seller.id), i.sale.seller.fullName, i);
    add(groups.byDay, day.toISOString(), dayLabel.format(day), i);
    add(
      groups.byProduct,
      `${String(i.product.sortOrder).padStart(6, "0")}-${i.product.id}`,
      i.product.name,
      i,
    );
  }
  const byRevenue = (m: Map<string, ReportRow>) =>
    [...m.values()].sort((a, b) => b.revenue - a.revenue);
  const byKey = (m: Map<string, ReportRow>) =>
    [...m.values()].sort((a, b) => a.key.localeCompare(b.key));

  return {
    total,
    byPoint: byRevenue(groups.byPoint),
    bySeller: byRevenue(groups.bySeller),
    byDay: byKey(groups.byDay),
    byProduct: byKey(groups.byProduct),
  };
}
