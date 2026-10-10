import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { MobileShell } from "@/components/MobileShell";
import { QtyInput } from "@/components/QtyInput";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { acceptDeliveryAction } from "../../actions";

export default async function AcceptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SELLER");
  const tripId = Number((await params).id);
  // Только рейсы на точку этого продавца, ожидающие приёма
  const trip = Number.isInteger(tripId)
    ? await prisma.trip.findFirst({
        where: {
          id: tripId,
          status: "DELIVERED",
          point: { sellers: { some: { userId: user.id } } },
        },
        include: {
          driver: { select: { fullName: true } },
          // Количества водителя сюда намеренно не выбираются
          items: {
            select: { productId: true, product: { select: { name: true, sortOrder: true } } },
          },
        },
      })
    : null;
  if (!trip) notFound();
  const items = trip.items.sort((a, b) => a.product.sortOrder - b.product.sortOrder);

  return (
    <MobileShell title={`Приём рейса №${trip.id}`} backHref="/seller">
      <div className="card">
        <p>Водитель: {trip.driver.fullName}</p>
        <p className="mt-1 text-sm text-zinc-500">
          Пересчитайте, что выгрузили, и введите количество по каждому виду. Исправить после
          подтверждения нельзя.
        </p>
      </div>
      <ActionForm
        action={acceptDeliveryAction}
        submitLabel="Подтвердить приём"
        confirm="Подтвердить приём? Изменить количество после этого нельзя."
        wide
      >
        <input type="hidden" name="tripId" value={trip.id} />
        <div className="card">
          {items.map((i) => (
            <QtyInput key={i.productId} name={`qty_${i.productId}`} label={i.product.name} />
          ))}
        </div>
      </ActionForm>
    </MobileShell>
  );
}
