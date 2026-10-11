import { ExportLink } from "@/components/ExportLink";
import { PageHeader } from "@/components/ui";
import { type ReportRow, salesReport } from "@/domain/reports";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, formatMoney, parseDay } from "@/lib/labels";

function ReportTable({
  title,
  first,
  rows,
  total,
}: {
  title: string;
  first: string;
  rows: ReportRow[];
  total: { qty: number; revenue: number; commission: number };
}) {
  return (
    <section className="card overflow-x-auto">
      <h2 className="h2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Продаж за период нет.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{first}</th>
              <th className="num">Продано, шт.</th>
              <th className="num">Выручка</th>
              <th className="num">Начислено продавцам</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num">{r.qty}</td>
                <td className="num">{formatMoney(r.revenue)}</td>
                <td className="num">{formatMoney(r.commission)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>Итого</td>
              <td className="num">{total.qty}</td>
              <td className="num">{formatMoney(total.revenue)}</td>
              <td className="num">{formatMoney(total.commission)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole("MANAGER");
  const search = await searchParams;
  const to = parseDay(search.to);
  const report = await salesReport(prisma, {
    from: parseDay(search.from),
    to: to ? addDays(to, 1) : undefined,
  });
  const filters = { from: search.from, to: search.to };

  return (
    <>
      <PageHeader
        title="Отчёты"
        hint="Сколько продано, выручка и зарплата продавцов за выбранный период."
      />

      <form className="card mb-6 grid gap-3 sm:grid-cols-4" method="get">
        <div>
          <label className="label">С даты</label>
          <input
            type="date"
            name="from"
            defaultValue={search.from}
            className="input"
          />
        </div>
        <div>
          <label className="label">По дату</label>
          <input
            type="date"
            name="to"
            defaultValue={search.to}
            className="input"
          />
        </div>
        <div className="flex items-end">
          <button className="btn-secondary min-h-11 w-full">Показать</button>
        </div>
        <div className="flex items-end">
          <ExportLink report="summary" params={filters} />
        </div>
      </form>
      <p className="-mt-3 mb-6 text-sm text-zinc-500">
        Без дат отчёт строится за весь сезон. Отменённые продажи не учитываются.
      </p>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          ["Продано, шт.", String(report.total.qty)],
          ["Выручка", formatMoney(report.total.revenue)],
          ["Начислено продавцам", formatMoney(report.total.commission)],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ReportTable
          title="По точкам"
          first="Точка"
          rows={report.byPoint}
          total={report.total}
        />
        <ReportTable
          title="По продавцам (зарплата)"
          first="Продавец"
          rows={report.bySeller}
          total={report.total}
        />
        <ReportTable
          title="По дням"
          first="День"
          rows={report.byDay}
          total={report.total}
        />
        <ReportTable
          title="По видам"
          first="Вид"
          rows={report.byProduct}
          total={report.total}
        />
      </div>

      <section className="card mt-6">
        <h2 className="h2">Другие выгрузки</h2>
        <div className="flex flex-wrap gap-3">
          <ExportLink
            report="sales"
            params={filters}
            label="Все продажи построчно"
          />
          <ExportLink report="shifts" label="Смены и пересчёты" />
          <ExportLink
            report="movements"
            params={filters}
            label="Журнал движений"
          />
          <ExportLink report="shortages" label="Недостачи и инциденты" />
          <ExportLink report="stock" label="Остатки по местам" />
        </div>
      </section>
    </>
  );
}
