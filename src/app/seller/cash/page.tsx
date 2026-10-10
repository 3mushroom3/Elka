import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { CountDiffs } from "@/components/CountDiffs";
import { MobileShell } from "@/components/MobileShell";
import { currentShift } from "@/domain/shift";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/labels";
import { shiftCountDiffs, shiftSummary } from "@/lib/shift-summary";
import { closeShiftAction } from "../actions";

export default async function CashPage() {
  const user = await requireRole("SELLER");
  const shift = await currentShift(prisma, user.id);
  if (!shift) redirect("/seller");
  if (shift.status === "OPEN") redirect("/seller/close");

  const [summary, counts] = await Promise.all([shiftSummary(shift.id), shiftCountDiffs(shift.id)]);

  return (
    <MobileShell title="Закрыть смену">
      <CountDiffs counts={counts.filter((c) => c.kind === "EVENING")} />
      <div className="card">
        <p className="font-semibold">Шаг 2 из 2: сдача денег</p>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-lg">
          <dt>Продано, шт.</dt>
          <dd className="text-right font-bold tabular-nums">{summary.qty}</dd>
          <dt>Переводом</dt>
          <dd className="text-right tabular-nums">{formatMoney(summary.byPayment.TRANSFER)}</dd>
          <dt>Картой</dt>
          <dd className="text-right tabular-nums">{formatMoney(summary.byPayment.CARD)}</dd>
          <dt className="font-semibold">Наличными должно быть</dt>
          <dd className="text-right text-2xl font-bold tabular-nums">
            {formatMoney(summary.byPayment.CASH)}
          </dd>
        </dl>
      </div>
      <ActionForm
        action={closeShiftAction}
        submitLabel="Закрыть смену"
        confirm="Закрыть смену с этой суммой? Изменить её после этого нельзя."
        wide
      >
        <div className="card">
          <label className="label" htmlFor="cash">
            Сколько наличных в кассе по факту, ₽
          </label>
          <input
            id="cash"
            name="cash"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            className="h-16 w-full rounded-xl border border-zinc-300 text-center text-3xl font-bold tabular-nums outline-none focus:border-emerald-600"
          />
        </div>
      </ActionForm>
    </MobileShell>
  );
}
