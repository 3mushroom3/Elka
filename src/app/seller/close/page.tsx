import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { MobileShell } from "@/components/MobileShell";
import { QtyInput } from "@/components/QtyInput";
import { currentShift, productsToCount } from "@/domain/shift";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eveningCountAction } from "../actions";

export default async function CloseShiftPage() {
  const user = await requireRole("SELLER");
  const shift = await currentShift(prisma, user.id);
  if (!shift) redirect("/seller");
  if (shift.status === "COUNTED") redirect("/seller/cash");

  const location = await prisma.location.findUniqueOrThrow({ where: { pointId: shift.pointId } });
  // Только названия: расчётный остаток продавцу не показывается
  const products = await productsToCount(prisma, location.id);

  return (
    <MobileShell title="Закрыть смену" backHref="/seller">
      <div className="card">
        <p className="font-semibold">Шаг 1 из 2: вечерний пересчёт</p>
        <p className="mt-1 text-sm text-zinc-500">
          Пересчитайте все стволы на точке и введите количество по каждому виду. После
          подтверждения продажи в этой смене закрываются, изменить цифры нельзя.
        </p>
      </div>
      <ActionForm
        action={eveningCountAction}
        submitLabel="Подтвердить пересчёт"
        confirm="Подтвердить пересчёт? Продажи после этого закрыты, изменить цифры нельзя."
        wide
      >
        <div className="card">
          {products.map((p) => (
            <QtyInput key={p.id} name={`qty_${p.id}`} label={p.name} />
          ))}
        </div>
      </ActionForm>
    </MobileShell>
  );
}
