import {
  Banknote,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  type LucideIcon,
  PackageOpen,
  Trash2,
  TriangleAlert,
  Truck,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { Chip, Empty, PageHeader, Qty, Stat } from "@/components/ui";
import { getAllBalances } from "@/domain/ledger";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dayStart, formatMoney, formatTime, locationName } from "@/lib/labels";
import { listLocations, listProducts } from "@/lib/queries";

type Todo = {
  icon: LucideIcon;
  tone: "red" | "amber";
  title: string;
  detail: string;
  href: string;
  action: string;
};

// Склонение: 1 заявка, 2 заявки, 5 заявок
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${n} ${few}`;
  return `${n} ${many}`;
}

export default async function ManagerDashboard() {
  await requireRole("MANAGER");
  const today = dayStart();
  const [
    products,
    locations,
    balances,
    newRequests,
    openIncidents,
    cancelRequests,
    pendingWriteoffs,
    activeTrips,
    points,
    todayShifts,
    todaySales,
    uncheckedShifts,
  ] = await Promise.all([
    listProducts(false),
    listLocations(),
    getAllBalances(prisma),
    prisma.deliveryRequest.count({ where: { status: "NEW" } }),
    prisma.incident.count({ where: { status: "OPEN" } }),
    prisma.sale.count({ where: { cancelStatus: "REQUESTED" } }),
    prisma.writeoffRequest.count({ where: { status: "PENDING" } }),
    prisma.trip.findMany({
      where: {
        status: { in: ["ASSIGNED", "LOADED", "IN_TRANSIT", "DELIVERED"] },
      },
      select: { driverId: true, pointId: true, status: true },
    }),
    prisma.point.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.shift.findMany({
      where: {
        OR: [{ status: { not: "CLOSED" } }, { openedAt: { gte: today } }],
      },
      orderBy: { id: "desc" },
      include: { seller: { select: { fullName: true } } },
    }),
    prisma.saleItem.findMany({
      where: {
        sale: { createdAt: { gte: today }, cancelStatus: { not: "CANCELLED" } },
      },
      select: { qty: true, price: true, sale: { select: { pointId: true } } },
    }),
    prisma.shift.findMany({
      where: {
        status: "CLOSED",
        OR: [{ cashReceivedAt: null }, { stickersCheckedAt: null }],
      },
      orderBy: { id: "asc" },
      include: {
        point: { select: { name: true } },
        seller: { select: { fullName: true } },
      },
    }),
  ]);

  const totalAt = (locationId: number | undefined) =>
    [...(balances.get(locationId ?? 0)?.values() ?? [])].reduce(
      (a, b) => a + b,
      0,
    );

  // ---------- Сегодня по точкам ----------
  const pointRows = points.map((p) => {
    const sales = todaySales.filter((i) => i.sale.pointId === p.id);
    return {
      point: p,
      // самая свежая смена точки за сегодня (или незакрытая со вчера)
      shift: todayShifts.find((s) => s.pointId === p.id),
      qty: sales.reduce((n, i) => n + i.qty, 0),
      revenue: sales.reduce((n, i) => n + i.qty * i.price, 0),
      stock: totalAt(locations.find((l) => l.pointId === p.id)?.id),
      onTheWay: activeTrips.some((t) => t.pointId === p.id),
    };
  });
  const soldToday = pointRows.reduce((n, r) => n + r.qty, 0);
  const revenueToday = pointRows.reduce((n, r) => n + r.revenue, 0);

  // ---------- Что требует решения ----------
  const todos: Todo[] = [];
  if (cancelRequests > 0) {
    todos.push({
      icon: Undo2,
      tone: "red",
      title: `Продавец просит отменить продажу: ${cancelRequests}`,
      detail: "Пока вы не ответите, продавец не сможет закрыть смену",
      href: "/manager/sales",
      action: "Ответить",
    });
  }
  if (pendingWriteoffs > 0) {
    todos.push({
      icon: Trash2,
      tone: "red",
      title: `Запрос на списание: ${pendingWriteoffs}`,
      detail:
        "Посмотрите фото и решите. До ответа продавец не сможет закрыть смену",
      href: "/manager/writeoffs",
      action: "Посмотреть",
    });
  }
  if (newRequests > 0) {
    todos.push({
      icon: ClipboardList,
      tone: "amber",
      title: `${plural(newRequests, "заявка", "заявки", "заявок")} на завоз`,
      detail: "Утвердите количество и назначьте водителя",
      href: "/manager/requests",
      action: "Рассмотреть",
    });
  }
  if (openIncidents > 0) {
    todos.push({
      icon: TriangleAlert,
      tone: "amber",
      title: `Не разобрано: ${plural(openIncidents, "расхождение", "расхождения", "расхождений")}`,
      detail: "Недостачи, расхождения при приёме и по деньгам, скидки",
      href: "/manager/incidents",
      action: "Разобрать",
    });
  }
  for (const loc of locations.filter((l) => l.type === "DRIVER")) {
    const qty = totalAt(loc.id);
    // Товар в машине по незавершённому рейсу - это нормально
    const busy = activeTrips.some(
      (t) => t.driverId === loc.driverId && t.status !== "ASSIGNED",
    );
    if (qty > 0 && !busy) {
      todos.push({
        icon: Truck,
        tone: "amber",
        title: `За водителем числится ${qty} шт. без рейса`,
        detail: `${loc.driver?.fullName}: примите товар на склад или разберите расхождение`,
        href: "/manager/deliveries",
        action: "Принять",
      });
    }
  }
  for (const r of pointRows) {
    if (
      r.stock <= r.point.lowStockThreshold &&
      !r.onTheWay &&
      r.shift?.status === "OPEN"
    ) {
      todos.push({
        icon: PackageOpen,
        tone: "amber",
        title: `Мало товара: ${r.point.name}`,
        detail: `Осталось ${r.stock} шт., завоз не назначен`,
        href: "/manager/requests#new",
        action: "Назначить завоз",
      });
    }
  }
  for (const s of uncheckedShifts) {
    todos.push({
      icon: Banknote,
      tone: "amber",
      title: `Смена закрыта, примите деньги и стикеры: ${s.point.name}`,
      detail: `${s.seller.fullName}, наличными сдано ${formatMoney(s.cashActual ?? 0)}`,
      href: `/manager/shifts/${s.id}`,
      action: "Открыть смену",
    });
  }

  // ---------- Где сейчас товар ----------
  // Показываем только те виды, которые где-то числятся: без столбцов из одних нулей
  const places = locations.filter((l) => l.type !== "SUPPLIER");
  const shownProducts = products.filter((p) =>
    places.some((l) => (balances.get(l.id)?.get(p.id) ?? 0) !== 0),
  );
  const rowOf = (locationId: number) => {
    const cells = shownProducts.map(
      (p) => balances.get(locationId)?.get(p.id) ?? 0,
    );
    return { cells, total: cells.reduce((a, b) => a + b, 0) };
  };
  const real = places
    .filter(
      (l) =>
        l.type === "WAREHOUSE" || l.type === "DRIVER" || l.type === "POINT",
    )
    .map((l) => ({ loc: l, ...rowOf(l.id) }))
    // Водителей и закрытые точки показываем, только если за ними что-то числится
    .filter(
      (r) =>
        r.loc.type === "WAREHOUSE" ||
        r.total !== 0 ||
        (r.loc.type === "POINT" && r.loc.point?.isActive),
    );
  const outcomes = places
    .filter(
      (l) =>
        l.type === "SOLD" || l.type === "WRITTEN_OFF" || l.type === "SHORTAGE",
    )
    .map((l) => ({ loc: l, ...rowOf(l.id) }));
  const sumOf = (type: string) =>
    real.filter((r) => r.loc.type === type).reduce((n, r) => n + r.total, 0);

  return (
    <>
      <PageHeader title="Главная" />

      <section className="card mb-6">
        <h2 className="h2">Что требует вашего решения</h2>
        {todos.length === 0 ? (
          <p className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-800">
            <CircleCheck size={24} className="shrink-0" />
            Всё в порядке: нерешённых вопросов нет.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todos.map((t, i) => (
              <li key={i}>
                <Link
                  href={t.href}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition hover:border-emerald-500 hover:bg-emerald-50/40"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                      t.tone === "red"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    <t.icon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t.title}</span>
                    <span className="block text-sm text-zinc-500">
                      {t.detail}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white sm:flex">
                    {t.action}
                    <ChevronRight size={16} />
                  </span>
                  <ChevronRight
                    size={20}
                    className="shrink-0 text-zinc-400 sm:hidden"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Продано сегодня"
          value={`${soldToday} шт.`}
          sub={formatMoney(revenueToday)}
        />
        <Stat
          label="На складе"
          value={sumOf("WAREHOUSE")}
          href="/manager/warehouse"
        />
        <Stat
          label="В пути у водителей"
          value={sumOf("DRIVER")}
          sub={activeTrips.length ? `рейсов: ${activeTrips.length}` : undefined}
          href="/manager/deliveries"
        />
        <Stat label="На точках" value={sumOf("POINT")} />
      </div>

      <section className="card mb-6 overflow-x-auto">
        <h2 className="h2">Точки сегодня</h2>
        {pointRows.length === 0 ? (
          <Empty>Точек пока нет. Добавьте их в разделе «Точки».</Empty>
        ) : (
          <>
            {/* Телефон: карточки вместо широкой таблицы */}
            <ul className="flex flex-col gap-2 sm:hidden">
              {pointRows.map((r) => (
                <li
                  key={r.point.id}
                  className="rounded-xl border border-zinc-200 p-3"
                >
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.point.name}</span>
                    {r.shift ? (
                      <Chip
                        tone={
                          r.shift.status === "OPEN"
                            ? "green"
                            : r.shift.status === "COUNTED"
                              ? "amber"
                              : "gray"
                        }
                      >
                        {r.shift.status === "OPEN"
                          ? `Открыта с ${formatTime(r.shift.openedAt)}`
                          : r.shift.status === "COUNTED"
                            ? "Сдаёт деньги"
                            : "Закрыта"}
                      </Chip>
                    ) : (
                      <Chip tone="red">Не открыта</Chip>
                    )}
                  </p>
                  {r.shift && (
                    <p className="text-sm text-zinc-500">
                      {r.shift.seller.fullName}
                    </p>
                  )}
                  <p className="mt-2 flex justify-between text-sm">
                    <span>
                      Продано: <b>{r.qty} шт.</b> на{" "}
                      <b>{formatMoney(r.revenue)}</b>
                    </span>
                    <span
                      className={
                        r.stock <= r.point.lowStockThreshold
                          ? "font-semibold text-red-600"
                          : ""
                      }
                    >
                      Остаток: {r.stock}
                    </span>
                  </p>
                  {r.shift && (
                    <Link
                      href={`/manager/shifts/${r.shift.id}`}
                      className="mt-2 inline-block text-sm font-medium text-emerald-700"
                    >
                      Подробнее о смене ›
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <table className="table">
                <thead>
                  <tr>
                    <th>Точка</th>
                    <th>Смена</th>
                    <th className="num">Продано</th>
                    <th className="num">Выручка</th>
                    <th className="num">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {pointRows.map((r) => (
                    <tr key={r.point.id}>
                      <td className="font-medium">{r.point.name}</td>
                      <td>
                        {r.shift ? (
                          <Link
                            href={`/manager/shifts/${r.shift.id}`}
                            className="inline-block"
                          >
                            <Chip
                              tone={
                                r.shift.status === "OPEN"
                                  ? "green"
                                  : r.shift.status === "COUNTED"
                                    ? "amber"
                                    : "gray"
                              }
                            >
                              {r.shift.status === "OPEN"
                                ? `Открыта с ${formatTime(r.shift.openedAt)}`
                                : r.shift.status === "COUNTED"
                                  ? "Сдаёт деньги"
                                  : "Закрыта"}
                            </Chip>
                            <span className="mt-0.5 block text-sm text-zinc-500">
                              {r.shift.seller.fullName}
                            </span>
                          </Link>
                        ) : (
                          <Chip tone="red">Не открыта</Chip>
                        )}
                      </td>
                      <td className="num">
                        <Qty value={r.qty} />
                      </td>
                      <td className="num">
                        {r.revenue ? (
                          formatMoney(r.revenue)
                        ) : (
                          <span className="zero">–</span>
                        )}
                      </td>
                      <td className="num">
                        {r.stock <= r.point.lowStockThreshold ? (
                          <Chip tone="red">{r.stock} · мало</Chip>
                        ) : (
                          r.stock
                        )}
                        {r.onTheWay && (
                          <span className="block text-sm text-zinc-500">
                            завоз в пути
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Где сейчас товар</h2>
        {shownProducts.length === 0 ? (
          <Empty>Товара пока нет. Оформите приход в разделе «Склад».</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Место</th>
                {shownProducts.map((p) => (
                  <th key={p.id} className="num">
                    {p.name}
                  </th>
                ))}
                <th className="num">Всего</th>
              </tr>
            </thead>
            <tbody>
              {real.map((r) => (
                <tr key={r.loc.id}>
                  <td className="font-medium sm:whitespace-nowrap">
                    {locationName(r.loc)}
                  </td>
                  {r.cells.map((c, j) => (
                    <td key={shownProducts[j].id} className="num">
                      <Qty value={c} />
                    </td>
                  ))}
                  <td className="num font-semibold">
                    <Qty value={r.total} />
                  </td>
                </tr>
              ))}
              {outcomes.map((r, i) => (
                <tr key={r.loc.id} className="text-zinc-500">
                  <td
                    className={`sm:whitespace-nowrap ${i === 0 ? "border-t-2 border-t-zinc-200" : ""}`}
                  >
                    {locationName(r.loc)} за сезон
                  </td>
                  {r.cells.map((c, j) => (
                    <td
                      key={shownProducts[j].id}
                      className={`num ${i === 0 ? "border-t-2 border-t-zinc-200" : ""}`}
                    >
                      <Qty value={c} />
                    </td>
                  ))}
                  <td
                    className={`num font-semibold ${i === 0 ? "border-t-2 border-t-zinc-200" : ""}`}
                  >
                    <Qty value={r.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
