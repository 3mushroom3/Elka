import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { MobileShell } from "@/components/MobileShell";
import { currentShift } from "@/domain/shift";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney, formatTime, PAYMENT_LABEL } from "@/lib/labels";
import { shiftSummary } from "@/lib/shift-summary";
import { requestCancelAction } from "../actions";

const CANCEL_LABEL = {
  REQUESTED: "Отмена запрошена, ждём менеджера",
  CANCELLED: "Отменена менеджером",
  REJECTED: "В отмене отказано",
} as const;

export default async function ShiftSalesPage() {
  const user = await requireRole("SELLER");
  const shift = await currentShift(prisma, user.id);
  if (!shift) redirect("/seller");

  const [sales, summary] = await Promise.all([
    prisma.sale.findMany({
      where: { shiftId: shift.id },
      orderBy: { id: "desc" },
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
    shiftSummary(shift.id),
  ]);

  return (
    <MobileShell title="Продажи за смену" backHref="/seller">
      <div className="card">
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-lg">
          <dt>Продано, шт.</dt>
          <dd className="text-right font-bold tabular-nums">{summary.qty}</dd>
          <dt>Выручка</dt>
          <dd className="text-right font-bold tabular-nums">{formatMoney(summary.revenue)}</dd>
          {(["CASH", "TRANSFER", "CARD"] as const).map((p) => (
            <div key={p} className="contents text-base text-zinc-500">
              <dt>{PAYMENT_LABEL[p]}</dt>
              <dd className="text-right tabular-nums">{formatMoney(summary.byPayment[p])}</dd>
            </div>
          ))}
          <dt className="mt-2 text-emerald-800">Мой заработок</dt>
          <dd className="mt-2 text-right font-bold text-emerald-800 tabular-nums">
            {formatMoney(summary.commission)}
          </dd>
        </dl>
      </div>

      {sales.length === 0 && <div className="card text-zinc-500">Продаж пока нет.</div>}
      {sales.map((sale) => (
        <div
          key={sale.id}
          className={`card ${sale.cancelStatus === "CANCELLED" ? "opacity-60" : ""}`}
        >
          {sale.items.map((i) => (
            <p key={i.id} className="flex justify-between gap-2 text-lg">
              <span className={sale.cancelStatus === "CANCELLED" ? "line-through" : ""}>
                {i.product.name} × {i.qty}
              </span>
              <span className="font-bold tabular-nums">{formatMoney(i.price * i.qty)}</span>
            </p>
          ))}
          <p className="text-sm text-zinc-500">
            №{sale.id} · {formatTime(sale.createdAt)} · {PAYMENT_LABEL[sale.payment].toLowerCase()}
            {sale.items.some((i) => i.discountReason) &&
              ` · скидка: ${sale.items.map((i) => i.discountReason).join("")}`}
          </p>
          {sale.cancelStatus !== "NONE" && (
            <p className="mt-1 text-sm font-medium text-amber-700">
              {CANCEL_LABEL[sale.cancelStatus]}
              {sale.cancelComment && `: ${sale.cancelComment}`}
            </p>
          )}
          {sale.cancelStatus === "NONE" && shift.status === "OPEN" && (
            <details className="mt-2">
              <summary className="cursor-pointer py-2 text-sm text-red-700">
                Ошибка? Запросить отмену
              </summary>
              <ActionForm action={requestCancelAction} submitLabel="Отправить менеджеру" wide>
                <input type="hidden" name="saleId" value={sale.id} />
                <label className="label">Что не так</label>
                <input name="reason" className="input min-h-12" required />
              </ActionForm>
            </details>
          )}
        </div>
      ))}
    </MobileShell>
  );
}
