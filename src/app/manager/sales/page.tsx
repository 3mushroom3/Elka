import type { Prisma } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { ExportLink } from "@/components/ExportLink";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, formatDateTime, formatMoney, parseDay, PAYMENT_LABEL } from "@/lib/labels";
import { listProducts } from "@/lib/queries";
import { decideCancelAction } from "../actions";

const PAGE_SIZE = 300;

type Search = { point?: string; seller?: string; product?: string; from?: string; to?: string };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole("MANAGER");
  const search = await searchParams;
  const from = parseDay(search.from);
  const to = parseDay(search.to);

  const saleWhere: Prisma.SaleWhereInput = {
    pointId: Number(search.point) || undefined,
    sellerId: Number(search.seller) || undefined,
    createdAt: { gte: from, lt: to ? addDays(to, 1) : undefined },
  };
  const itemWhere: Prisma.SaleItemWhereInput = {
    productId: Number(search.product) || undefined,
    sale: saleWhere,
  };
  const itemInclude = {
    product: { select: { name: true } },
    sale: {
      include: { point: { select: { name: true } }, seller: { select: { fullName: true } } },
    },
  } as const;

  const [points, sellers, products, items, totals, pending] = await Promise.all([
    prisma.point.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { role: "SELLER" }, orderBy: { fullName: "asc" } }),
    listProducts(false),
    prisma.saleItem.findMany({
      where: itemWhere,
      orderBy: { id: "desc" },
      take: PAGE_SIZE,
      include: itemInclude,
    }),
    // Итоги считаются по всем подходящим продажам, а не только по показанным строкам
    prisma.saleItem.findMany({
      where: { ...itemWhere, sale: { ...saleWhere, cancelStatus: { not: "CANCELLED" } } },
      select: { qty: true, price: true, commission: true },
    }),
    prisma.saleItem.findMany({
      where: { sale: { cancelStatus: "REQUESTED" } },
      orderBy: { id: "asc" },
      include: itemInclude,
    }),
  ]);
  const totalQty = totals.reduce((sum, i) => sum + i.qty, 0);
  const totalRevenue = totals.reduce((sum, i) => sum + i.qty * i.price, 0);
  const totalCommission = totals.reduce((sum, i) => sum + i.commission, 0);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Продажи</h1>
        <ExportLink report="sales" params={search} />
      </div>

      {pending.length > 0 && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {pending.map((i) => (
            <section key={i.id} className="card border-l-8 border-l-amber-500">
              <h2 className="h2">Запрос отмены продажи №{i.saleId}</h2>
              <p>
                {i.product.name} × {i.qty} за {formatMoney(i.price * i.qty)} ·{" "}
                {PAYMENT_LABEL[i.sale.payment].toLowerCase()}
              </p>
              <p className="text-sm text-zinc-500">
                {i.sale.point.name} · {i.sale.seller.fullName} · {formatDateTime(i.sale.createdAt)}
              </p>
              <p className="mt-2">Причина: «{i.sale.cancelReason}»</p>
              <p className="mt-1 text-sm text-zinc-500">
                Пока запрос не рассмотрен, продавец не может закрыть смену.
              </p>
              <ActionForm action={decideCancelAction} submitLabel="Отменить продажу">
                <input type="hidden" name="saleId" value={i.saleId} />
                <input type="hidden" name="decision" value="approve" />
              </ActionForm>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-red-700">Отказать</summary>
                <ActionForm action={decideCancelAction} submitLabel="Отказать в отмене">
                  <input type="hidden" name="saleId" value={i.saleId} />
                  <input type="hidden" name="decision" value="reject" />
                  <label className="label mt-2">Комментарий для продавца</label>
                  <input name="comment" className="input" />
                </ActionForm>
              </details>
            </section>
          ))}
        </div>
      )}

      <form className="card mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" method="get">
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
        <div>
          <label className="label">Вид</label>
          <select name="product" defaultValue={search.product ?? ""} className="input">
            <option value="">Все</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">С даты</label>
          <input type="date" name="from" defaultValue={search.from} className="input" />
        </div>
        <div>
          <label className="label">По дату</label>
          <input type="date" name="to" defaultValue={search.to} className="input" />
        </div>
        <div className="flex items-end">
          <button className="btn-secondary min-h-11 w-full">Показать</button>
        </div>
      </form>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          ["Продано, шт.", String(totalQty)],
          ["Выручка", formatMoney(totalRevenue)],
          ["Начислено продавцам", formatMoney(totalCommission)],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <section className="card overflow-x-auto">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">Продаж нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Точка</th>
                <th>Продавец</th>
                <th>Вид</th>
                <th className="num">Кол-во</th>
                <th className="num">Стикер</th>
                <th className="num">Цена</th>
                <th className="num">Сумма</th>
                <th>Оплата</th>
                <th>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const cancelled = i.sale.cancelStatus === "CANCELLED";
                return (
                  <tr key={i.id} className={cancelled ? "text-zinc-400 line-through" : ""}>
                    <td>{i.saleId}</td>
                    <td className="whitespace-nowrap">{formatDateTime(i.sale.createdAt)}</td>
                    <td>{i.sale.point.name}</td>
                    <td>{i.sale.seller.fullName}</td>
                    <td>{i.product.name}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{i.stickerPrice}</td>
                    <td
                      className={`num ${i.price < i.stickerPrice ? "font-semibold text-red-600" : ""}`}
                    >
                      {i.price}
                    </td>
                    <td className="num">{i.price * i.qty}</td>
                    <td>{PAYMENT_LABEL[i.sale.payment]}</td>
                    <td className="no-underline">
                      {i.discountReason && `Скидка: ${i.discountReason}`}
                      {cancelled && " Отменена"}
                      {i.sale.cancelStatus === "REQUESTED" && " Запрошена отмена"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {items.length === PAGE_SIZE && (
          <p className="mt-3 text-sm text-zinc-500">
            Показаны последние {PAGE_SIZE} строк. Итоги выше посчитаны по всем продажам фильтра.
          </p>
        )}
      </section>
    </>
  );
}
