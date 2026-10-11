import { ExportLink } from "@/components/ExportLink";
import { PageHeader } from "@/components/ui";
import { summarizeShortages } from "@/domain/shortage";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney, ROLE_LABEL } from "@/lib/labels";

export default async function ShortagesPage() {
  await requireRole("MANAGER");
  const [incidents, users, points] = await Promise.all([
    prisma.incident.findMany(),
    prisma.user.findMany({
      select: { id: true, fullName: true, role: true, isActive: true },
    }),
    prisma.point.findMany({ orderBy: { name: "asc" } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const rows = summarizeShortages(incidents)
    .map((r) => ({ ...r, user: userById.get(r.userId)! }))
    .sort(
      (a, b) =>
        b.stemsCharged + b.stemsOpen - (a.stemsCharged + a.stemsOpen) ||
        b.cashCharged + b.cashOpen - (a.cashCharged + a.cashOpen),
    );

  // По точкам: дневные и ночные расхождения пересчётов за сезон
  const pointRows = points.map((p) => {
    const own = incidents.filter((i) => i.pointId === p.id);
    const sum = (types: string[]) =>
      own
        .filter((i) => types.includes(i.type))
        .reduce((n, i) => n + Math.abs(i.qty), 0);
    return {
      point: p,
      dayShortage: sum(["DAY_SHORTAGE"]),
      nightShortage: sum(["NIGHT_SHORTAGE"]),
      surplus: sum(["DAY_SURPLUS", "NIGHT_SURPLUS"]),
      cash: own
        .filter((i) => i.type === "CASH_MISMATCH" && i.amount < 0)
        .reduce((n, i) => n - i.amount, 0),
    };
  });
  const red = (n: number) =>
    n > 0 ? "font-semibold text-red-600" : "text-zinc-300";

  return (
    <>
      <PageHeader
        title="Недостачи за сезон"
        hint="Сколько не хватило по каждому сотруднику и по каждой точке."
      >
        <ExportLink report="shortages" />
      </PageHeader>

      <section className="card mb-6 overflow-x-auto">
        <h2 className="h2">По сотрудникам</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">Расхождений не было.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Роль</th>
                <th className="num">Стволы: записано</th>
                <th className="num">Стволы: на разборе</th>
                <th className="num">Деньги: записано</th>
                <th className="num">Деньги: на разборе</th>
                <th className="num">Скидки ниже стикера</th>
                <th className="num">Снято инцидентов</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    {r.user.fullName}
                    {!r.user.isActive && (
                      <span className="text-zinc-400"> (отключён)</span>
                    )}
                  </td>
                  <td>{ROLE_LABEL[r.user.role]}</td>
                  <td className={`num ${red(r.stemsCharged)}`}>
                    {r.stemsCharged}
                  </td>
                  <td
                    className={`num ${r.stemsOpen > 0 ? "font-semibold text-amber-600" : "text-zinc-300"}`}
                  >
                    {r.stemsOpen}
                  </td>
                  <td className={`num ${red(r.cashCharged)}`}>
                    {formatMoney(r.cashCharged)}
                  </td>
                  <td
                    className={`num ${r.cashOpen > 0 ? "font-semibold text-amber-600" : "text-zinc-300"}`}
                  >
                    {formatMoney(r.cashOpen)}
                  </td>
                  <td className="num">{formatMoney(r.discounts)}</td>
                  <td className="num">{r.dismissed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-sm text-zinc-500">
          «На разборе»: инцидент открыт и числится за ответственным из
          инцидента. «Записано»: менеджер закрыл инцидент с решением «записать
          на сотрудника». Излишки недостачу не уменьшают. Ночные расхождения до
          разбора числятся за тем, кто сдал точку вечером.
        </p>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">По точкам</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Точка</th>
              <th className="num">Недостача за смены, шт.</th>
              <th className="num">Ночная недостача, шт.</th>
              <th className="num">Излишки, шт.</th>
              <th className="num">Недостача наличных</th>
            </tr>
          </thead>
          <tbody>
            {pointRows.map((r) => (
              <tr key={r.point.id}>
                <td>
                  <a
                    href={`/manager/shifts?point=${r.point.id}`}
                    className="text-emerald-700 underline"
                  >
                    {r.point.name}
                  </a>
                </td>
                <td className={`num ${red(r.dayShortage)}`}>{r.dayShortage}</td>
                <td className={`num ${red(r.nightShortage)}`}>
                  {r.nightShortage}
                </td>
                <td className="num">{r.surplus}</td>
                <td className={`num ${red(r.cash)}`}>{formatMoney(r.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-zinc-500">
          Здесь все зафиксированные расхождения пересчётов, включая те, что
          потом сняты при разборе. Название точки ведёт к истории её смен и
          пересчётов.
        </p>
      </section>
    </>
  );
}
