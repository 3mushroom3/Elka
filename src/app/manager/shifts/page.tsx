import Link from "next/link";
import { ExportLink } from "@/components/ExportLink";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatMoney, formatTime, SHIFT_STATUS_LABEL } from "@/lib/labels";

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ point?: string; seller?: string }>;
}) {
  await requireRole("MANAGER");
  const search = await searchParams;

  const [points, sellers, shifts] = await Promise.all([
    prisma.point.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "SELLER" }, orderBy: { fullName: "asc" } }),
    prisma.shift.findMany({
      where: {
        pointId: Number(search.point) || undefined,
        sellerId: Number(search.seller) || undefined,
      },
      orderBy: { id: "desc" },
      take: 100,
      include: {
        point: { select: { name: true } },
        seller: { select: { fullName: true } },
        counts: { include: { items: { where: { diff: { not: 0 } } } } },
        sales: {
          where: { cancelStatus: { not: "CANCELLED" } },
          select: { total: true, items: { select: { qty: true } } },
        },
      },
    }),
  ]);

  // Сумма расхождений пересчёта: отдельно недостача и излишек
  const diffText = (items: { diff: number }[] | undefined) => {
    if (!items) return "–";
    const minus = items.filter((i) => i.diff < 0).reduce((s, i) => s + i.diff, 0);
    const plus = items.filter((i) => i.diff > 0).reduce((s, i) => s + i.diff, 0);
    if (!minus && !plus) return "0";
    return [minus && String(minus), plus && `+${plus}`].filter(Boolean).join(" / ");
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Смены и пересчёты</h1>
        <ExportLink report="shifts" params={search} />
      </div>

      <form className="card mb-6 grid gap-3 sm:grid-cols-3" method="get">
        <div>
          <label className="label">Точка</label>
          <select name="point" defaultValue={search.point ?? ""} className="input">
            <option value="">Все</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Продавец</label>
          <select name="seller" defaultValue={search.seller ?? ""} className="input">
            <option value="">Все</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-secondary min-h-11 w-full">Показать</button>
        </div>
      </form>

      <section className="card overflow-x-auto">
        {shifts.length === 0 ? (
          <p className="text-sm text-zinc-500">Смен пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Открыта</th>
                <th>Закрыта</th>
                <th>Точка</th>
                <th>Продавец</th>
                <th>Статус</th>
                <th className="num">Утро, расх.</th>
                <th className="num">Вечер, расх.</th>
                <th className="num">Продано</th>
                <th className="num">Выручка</th>
                <th className="num">Наличные, расх.</th>
                <th>Проверено</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const morning = s.counts.find((c) => c.kind === "MORNING")?.items;
                const evening = s.counts.find((c) => c.kind === "EVENING")?.items;
                const cashDiff =
                  s.cashActual === null ? null : s.cashActual - (s.cashExpected ?? 0);
                const bad = (text: string) => (text !== "0" && text !== "–" ? "text-red-600" : "");
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/manager/shifts/${s.id}`} className="text-emerald-700 underline">
                        {s.id}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(s.openedAt)}</td>
                    <td className="whitespace-nowrap">{s.closedAt ? formatTime(s.closedAt) : ""}</td>
                    <td>{s.point.name}</td>
                    <td>{s.seller.fullName}</td>
                    <td>{SHIFT_STATUS_LABEL[s.status]}</td>
                    <td className={`num font-semibold ${bad(diffText(morning))}`}>
                      {diffText(morning)}
                    </td>
                    <td className={`num font-semibold ${bad(diffText(evening))}`}>
                      {diffText(evening)}
                    </td>
                    <td className="num">
                      {s.sales.reduce((n, sale) => n + sale.items.reduce((q, i) => q + i.qty, 0), 0)}
                    </td>
                    <td className="num">{formatMoney(s.sales.reduce((n, x) => n + x.total, 0))}</td>
                    <td className={`num font-semibold ${cashDiff ? "text-red-600" : ""}`}>
                      {cashDiff === null ? "–" : formatMoney(cashDiff)}
                    </td>
                    <td className="whitespace-nowrap">
                      {s.status !== "CLOSED"
                        ? ""
                        : `${s.cashReceivedAt ? "✓" : "✗"} деньги · ${s.stickersCheckedAt ? "✓" : "✗"} стикеры`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-sm text-zinc-500">
          Утреннее расхождение: разница с вечером прошлой смены (ночная). Вечернее: разница с
          расчётом за день. Показаны последние 100 смен.
        </p>
      </section>
    </>
  );
}
