import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAllBalances } from "@/domain/ledger";
import { dayStart, formatMoney, formatTime, locationName, SHIFT_STATUS_LABEL } from "@/lib/labels";
import { listLocations, listProducts } from "@/lib/queries";

export default async function ManagerDashboard() {
  await requireRole("MANAGER");
  const [products, locations, balances, newRequests, activeTrips, openIncidents] =
    await Promise.all([
      listProducts(),
      listLocations(),
      getAllBalances(prisma),
      prisma.deliveryRequest.count({ where: { status: "NEW" } }),
      prisma.trip.count({
        where: { status: { in: ["ASSIGNED", "LOADED", "IN_TRANSIT", "DELIVERED"] } },
      }),
      prisma.incident.count({ where: { status: "OPEN" } }),
    ]);

  // Сегодня по точкам: смена и продажи с начала суток
  const today = dayStart();
  const [points, todayShifts, todaySales] = await Promise.all([
    prisma.point.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({
      where: { OR: [{ status: { not: "CLOSED" } }, { openedAt: { gte: today } }] },
      orderBy: { id: "desc" },
      include: { seller: { select: { fullName: true } } },
    }),
    prisma.saleItem.findMany({
      where: { sale: { createdAt: { gte: today }, cancelStatus: { not: "CANCELLED" } } },
      select: { qty: true, price: true, sale: { select: { pointId: true } } },
    }),
  ]);
  const pointRows = points.map((p) => {
    const sales = todaySales.filter((i) => i.sale.pointId === p.id);
    return {
      point: p,
      // самая свежая смена точки за сегодня (или незакрытая со вчера)
      shift: todayShifts.find((s) => s.pointId === p.id),
      qty: sales.reduce((n, i) => n + i.qty, 0),
      revenue: sales.reduce((n, i) => n + i.qty * i.price, 0),
      stock: balances.get(locations.find((l) => l.pointId === p.id)?.id ?? 0),
    };
  });
  const soldToday = pointRows.reduce((n, r) => n + r.qty, 0);
  const revenueToday = pointRows.reduce((n, r) => n + r.revenue, 0);

  const rowOf = (locationId: number) => {
    const byProduct = balances.get(locationId);
    const cells = products.map((p) => byProduct?.get(p.id) ?? 0);
    return { cells, total: cells.reduce((a, b) => a + b, 0) };
  };

  const real = locations
    .filter((l) => l.type === "WAREHOUSE" || l.type === "DRIVER" || l.type === "POINT")
    .map((l) => ({ loc: l, ...rowOf(l.id) }))
    // Водителей и закрытые точки показываем, только если за ними что-то числится
    .filter(
      (r) =>
        r.loc.type === "WAREHOUSE" ||
        r.cells.some((c) => c !== 0) ||
        (r.loc.type === "POINT" && r.loc.point?.isActive),
    );
  const totals = locations
    .filter((l) => l.type === "SOLD" || l.type === "WRITTEN_OFF" || l.type === "SHORTAGE")
    .map((l) => ({ loc: l, ...rowOf(l.id) }));

  const inTransit = real
    .filter((r) => r.loc.type === "DRIVER")
    .reduce((sum, r) => sum + r.total, 0);
  const onPoints = real
    .filter((r) => r.loc.type === "POINT")
    .reduce((sum, r) => sum + r.total, 0);
  const warehouse = real.find((r) => r.loc.type === "WAREHOUSE")?.total ?? 0;

  return (
    <>
      <h1 className="h1">Панель</h1>

      <div className="mb-3 grid grid-cols-3 gap-3">
        {(
          [
            ["Новые заявки", newRequests, "/manager/requests"],
            ["Активные рейсы", activeTrips, "/manager/deliveries"],
            ["Открытые инциденты", openIncidents, "/manager/incidents"],
          ] as const
        ).map(([label, value, href]) => (
          <Link key={href} href={href} className="card hover:border-emerald-600">
            <p className="text-sm text-zinc-500">{label}</p>
            <p
              className={`text-2xl font-bold tabular-nums ${
                value > 0 && href !== "/manager/deliveries" ? "text-red-600" : ""
              }`}
            >
              {value}
            </p>
          </Link>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          ["На складе", warehouse],
          ["У водителей", inTransit],
          ["На точках", onPoints],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <section className="card mb-6 overflow-x-auto">
        <h2 className="h2">
          Сегодня: продано {soldToday} шт. на {formatMoney(revenueToday)}
        </h2>
        {pointRows.length === 0 ? (
          <p className="text-sm text-zinc-500">Точек пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Точка</th>
                <th>Смена</th>
                <th>Продавец</th>
                <th className="num">Продано</th>
                <th className="num">Выручка</th>
                <th className="num">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {pointRows.map((r) => {
                const stock = [...(r.stock?.values() ?? [])].reduce((a, b) => a + b, 0);
                return (
                  <tr key={r.point.id}>
                    <td>{r.point.name}</td>
                    <td>
                      {r.shift ? (
                        <Link
                          href={`/manager/shifts/${r.shift.id}`}
                          className="text-emerald-700 underline"
                        >
                          {SHIFT_STATUS_LABEL[r.shift.status]} с {formatTime(r.shift.openedAt)}
                        </Link>
                      ) : (
                        <span className="font-semibold text-red-600">Не открыта</span>
                      )}
                    </td>
                    <td>{r.shift?.seller.fullName}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num">{formatMoney(r.revenue)}</td>
                    <td
                      className={`num ${stock <= r.point.lowStockThreshold ? "font-semibold text-red-600" : ""}`}
                    >
                      {stock}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Где сейчас товар</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Место</th>
              {products.map((p) => (
                <th key={p.id} className="num">
                  {p.name}
                </th>
              ))}
              <th className="num">Всего</th>
            </tr>
          </thead>
          <tbody>
            {[...real, ...totals].map((r, i) => (
              <tr key={r.loc.id} className={i === real.length ? "border-t-2 border-zinc-300" : ""}>
                <td className="whitespace-nowrap">{locationName(r.loc)}</td>
                {r.cells.map((c, j) => (
                  <td
                    key={products[j].id}
                    className={`num ${c < 0 ? "font-semibold text-red-600" : c === 0 ? "text-zinc-300" : ""}`}
                  >
                    {c}
                  </td>
                ))}
                <td className="num font-semibold">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-zinc-500">
          Остатки не хранятся, а считаются из журнала движений.
        </p>
      </section>
    </>
  );
}
