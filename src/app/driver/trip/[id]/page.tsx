import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { MobileShell } from "@/components/MobileShell";
import { QtyInput } from "@/components/QtyInput";
import { TripTracker } from "@/components/TripTracker";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TRIP_STATUS_LABEL } from "@/lib/labels";
import { confirmLoadAction, confirmUnloadAction, departAction } from "../../actions";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("DRIVER");
  const tripId = Number((await params).id);
  // Водитель видит только свои рейсы
  const trip = Number.isInteger(tripId)
    ? await prisma.trip.findFirst({
        where: { id: tripId, driverId: user.id },
        include: {
          point: { select: { name: true, address: true } },
          items: { include: { product: { select: { name: true, sortOrder: true } } } },
        },
      })
    : null;
  if (!trip) notFound();
  const items = trip.items.sort((a, b) => a.product.sortOrder - b.product.sortOrder);

  return (
    <MobileShell title={`Рейс №${trip.id}`} backHref="/driver">
      <div className="card">
        <p className="text-sm text-zinc-500">{TRIP_STATUS_LABEL[trip.status]}</p>
        <p className="text-xl font-bold">{trip.point.name}</p>
        {trip.point.address && <p className="text-zinc-600">{trip.point.address}</p>}
      </div>

      {trip.status !== "ACCEPTED" && trip.status !== "CANCELLED" && (
        <TripTracker tripId={trip.id} />
      )}

      {trip.status === "ASSIGNED" && (
        <ActionForm
          action={confirmLoadAction}
          submitLabel="Подтвердить загрузку"
          confirm="Подтвердить загрузку? После этого товар числится за вами."
          wide
        >
          <input type="hidden" name="tripId" value={trip.id} />
          <div className="card">
            <p className="mb-2 text-sm text-zinc-500">
              Загрузите по списку и укажите, сколько взяли фактически.
            </p>
            {items.map((i) => (
              <QtyInput
                key={i.productId}
                name={`qty_${i.productId}`}
                label={i.product.name}
                hint={`по списку: ${i.qtyPlanned}`}
                defaultValue={i.qtyPlanned}
              />
            ))}
          </div>
        </ActionForm>
      )}

      {trip.status === "LOADED" && (
        <>
          <ItemsTable items={items.map((i) => [i.product.name, i.qtyLoaded ?? 0])} title="Загружено" />
          <ActionForm action={departAction} submitLabel="Выехал на точку" wide>
            <input type="hidden" name="tripId" value={trip.id} />
          </ActionForm>
        </>
      )}

      {trip.status === "IN_TRANSIT" && (
        <ActionForm
          action={confirmUnloadAction}
          submitLabel="Выгрузил"
          confirm="Отметить выгрузку? Продавец после этого вводит, сколько принял."
          wide
        >
          <input type="hidden" name="tripId" value={trip.id} />
          <div className="card">
            <p className="mb-2 text-sm text-zinc-500">Сколько выгрузили на точке.</p>
            {items.map((i) => (
              <QtyInput
                key={i.productId}
                name={`qty_${i.productId}`}
                label={i.product.name}
                hint={`загружено: ${i.qtyLoaded ?? 0}`}
                defaultValue={i.qtyLoaded ?? 0}
                max={i.qtyLoaded ?? 0}
              />
            ))}
          </div>
        </ActionForm>
      )}

      {trip.status === "DELIVERED" && (
        <>
          <ItemsTable
            items={items.map((i) => [i.product.name, i.qtyUnloaded ?? 0])}
            title="Выгружено"
          />
          <div className="card bg-amber-50">
            Ждём, пока продавец пересчитает и подтвердит приём. До этого товар числится за вами.
          </div>
        </>
      )}

      {trip.status === "ACCEPTED" && (
        <section className="card">
          <h2 className="h2">Итог рейса</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Вид</th>
                <th className="num">Загружено</th>
                <th className="num">Выгружено</th>
                <th className="num">Принято</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.productId}>
                  <td>{i.product.name}</td>
                  <td className="num">{i.qtyLoaded}</td>
                  <td className="num">{i.qtyUnloaded}</td>
                  <td
                    className={`num ${i.qtyReceived !== i.qtyUnloaded ? "font-bold text-red-600" : ""}`}
                  >
                    {i.qtyReceived}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {trip.status === "CANCELLED" && <div className="card">Рейс отменён менеджером.</div>}
    </MobileShell>
  );
}

function ItemsTable({ title, items }: { title: string; items: [string, number][] }) {
  return (
    <section className="card">
      <h2 className="h2">{title}</h2>
      {items.map(([name, qty]) => (
        <p key={name} className="flex justify-between py-1 text-lg">
          <span>{name}</span>
          <span className="font-bold tabular-nums">{qty}</span>
        </p>
      ))}
    </section>
  );
}
