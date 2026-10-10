import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  formatDateTime,
  formatMoney,
  formatTime,
  PAYMENT_LABEL,
  SHIFT_STATUS_LABEL,
} from "@/lib/labels";
import { shiftSummary } from "@/lib/shift-summary";
import { confirmShiftCheckAction } from "../../actions";

export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("MANAGER");
  const shiftId = Number((await params).id);
  const shift = Number.isInteger(shiftId)
    ? await prisma.shift.findUnique({
        where: { id: shiftId },
        include: {
          point: { select: { name: true } },
          seller: { select: { fullName: true } },
          cashReceivedBy: { select: { fullName: true } },
          stickersCheckedBy: { select: { fullName: true } },
          counts: {
            orderBy: { id: "asc" },
            include: {
              items: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } },
            },
          },
          sales: {
            orderBy: { id: "asc" },
            include: { items: { include: { product: { select: { name: true } } } } },
          },
        },
      })
    : null;
  if (!shift) notFound();

  const [summary, received] = await Promise.all([
    shiftSummary(shift.id),
    // Принято на точку за смену
    prisma.movement.groupBy({
      by: ["productId"],
      where: { shiftId: shift.id, type: "TRANSFER" },
      _sum: { qty: true },
    }),
  ]);
  const receivedTotal = received.reduce((n, r) => n + (r._sum.qty ?? 0), 0);
  // Сумма цен на стикерах, которые продавец должен сдать
  const stickerSum = shift.sales
    .filter((sale) => sale.cancelStatus !== "CANCELLED")
    .flatMap((sale) => sale.items)
    .reduce((n, i) => n + i.stickerPrice * i.qty, 0);
  const cashDiff = shift.cashActual === null ? null : shift.cashActual - (shift.cashExpected ?? 0);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/manager/shifts" className="text-emerald-700 underline">
          ‹ Все смены
        </Link>
      </p>
      <h1 className="h1">
        Смена №{shift.id} · {shift.point.name}
      </h1>
      <p className="-mt-3 mb-4 text-zinc-600">
        {shift.seller.fullName} · {SHIFT_STATUS_LABEL[shift.status]} · открыта{" "}
        {formatDateTime(shift.openedAt)}
        {shift.closedAt && `, закрыта ${formatDateTime(shift.closedAt)}`}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Продано, шт.", String(summary.qty)],
          ["Принято за смену, шт.", String(receivedTotal)],
          ["Выручка", formatMoney(summary.revenue)],
          ["Начислено продавцу", formatMoney(summary.commission)],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {shift.counts.map((c) => (
          <section key={c.id} className="card overflow-x-auto">
            <h2 className="h2">
              {c.kind === "MORNING" ? "Утренний пересчёт" : "Вечерний пересчёт"} ·{" "}
              {formatTime(c.createdAt)}
            </h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Вид</th>
                  <th className="num">
                    {c.kind === "MORNING" ? "Было вечером" : "Должно остаться"}
                  </th>
                  <th className="num">Насчитано</th>
                  <th className="num">Разница</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product.name}</td>
                    <td className="num">{i.qtyExpected}</td>
                    <td className="num">{i.qtyActual}</td>
                    <td className={`num font-semibold ${i.diff ? "text-red-600" : "text-zinc-300"}`}>
                      {i.diff > 0 ? `+${i.diff}` : i.diff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <section className="card mb-6 max-w-xl">
        <h2 className="h2">Деньги</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          <dt>Переводом</dt>
          <dd className="num">{formatMoney(summary.byPayment.TRANSFER)}</dd>
          <dt>Картой</dt>
          <dd className="num">{formatMoney(summary.byPayment.CARD)}</dd>
          <dt>Наличными по продажам</dt>
          <dd className="num">{formatMoney(summary.byPayment.CASH)}</dd>
          <dt>Наличными сдано</dt>
          <dd className="num">{shift.cashActual === null ? "–" : formatMoney(shift.cashActual)}</dd>
          <dt className="font-semibold">Расхождение</dt>
          <dd className={`num font-semibold ${cashDiff ? "text-red-600" : ""}`}>
            {cashDiff === null ? "–" : formatMoney(cashDiff)}
          </dd>
        </dl>

        {shift.status === "CLOSED" && (
          <div className="mt-4 grid gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2">
            <div>
              {shift.cashReceivedAt ? (
                <p className="text-emerald-700">
                  ✓ Наличные получены: {shift.cashReceivedBy?.fullName},{" "}
                  {formatDateTime(shift.cashReceivedAt)}
                </p>
              ) : (
                <ActionForm action={confirmShiftCheckAction} submitLabel="Наличные получены">
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <input type="hidden" name="what" value="cash" />
                </ActionForm>
              )}
            </div>
            <div>
              {shift.stickersCheckedAt ? (
                <p className="text-emerald-700">
                  ✓ Стикеры сверены: {shift.stickersCheckedBy?.fullName},{" "}
                  {formatDateTime(shift.stickersCheckedAt)}
                </p>
              ) : (
                <ActionForm action={confirmShiftCheckAction} submitLabel="Стикеры сверены">
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <input type="hidden" name="what" value="stickers" />
                </ActionForm>
              )}
            </div>
          </div>
        )}
        <p className="mt-3 text-sm text-zinc-500">
          Стикеров у продавца должно быть {summary.qty} шт. на сумму {formatMoney(stickerSum)}.
          Выручка меньше этой суммы на размер скидок.
        </p>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Продажи смены</h2>
        {shift.sales.length === 0 ? (
          <p className="text-sm text-zinc-500">Продаж не было.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Время</th>
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
              {shift.sales.flatMap((sale) =>
                sale.items.map((i) => (
                  <tr
                    key={i.id}
                    className={sale.cancelStatus === "CANCELLED" ? "text-zinc-400 line-through" : ""}
                  >
                    <td>{sale.id}</td>
                    <td>{formatTime(sale.createdAt)}</td>
                    <td>{i.product.name}</td>
                    <td className="num">{i.qty}</td>
                    <td className="num">{i.stickerPrice}</td>
                    <td
                      className={`num ${i.price < i.stickerPrice ? "font-semibold text-red-600" : ""}`}
                    >
                      {i.price}
                    </td>
                    <td className="num">{i.price * i.qty}</td>
                    <td>{PAYMENT_LABEL[sale.payment]}</td>
                    <td>
                      {i.discountReason && `Скидка: ${i.discountReason}`}
                      {sale.cancelStatus === "CANCELLED" && " Отменена"}
                      {sale.cancelStatus === "REQUESTED" && " Запрошена отмена"}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
