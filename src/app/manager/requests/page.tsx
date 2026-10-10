import { LocationType } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { getBalances, systemLocationId } from "@/domain/ledger";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, REQUEST_STATUS_LABEL } from "@/lib/labels";
import { listProducts } from "@/lib/queries";
import { approveRequestAction, createDeliveryAction, rejectRequestAction } from "../actions";

type Option = { id: number; label: string };

function DriverSelect({ drivers }: { drivers: Option[] }) {
  return (
    <>
      <label className="label mt-3">Водитель</label>
      <select name="driverId" className="input" required defaultValue="">
        <option value="" disabled>
          Выберите водителя
        </option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </>
  );
}

export default async function RequestsPage() {
  await requireRole("MANAGER");
  const warehouseId = await systemLocationId(prisma, LocationType.WAREHOUSE);
  const requestInclude = {
    point: { select: { name: true } },
    createdBy: { select: { fullName: true } },
    items: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } },
  } as const;

  const [products, balances, reserved, driverUsers, points, pending, history] = await Promise.all([
    listProducts(),
    getBalances(prisma, warehouseId),
    prisma.tripItem.groupBy({
      by: ["productId"],
      where: { trip: { status: "ASSIGNED" } },
      _sum: { qtyPlanned: true },
    }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.point.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.deliveryRequest.findMany({
      where: { status: "NEW" },
      orderBy: { id: "asc" },
      include: requestInclude,
    }),
    prisma.deliveryRequest.findMany({
      where: { status: { not: "NEW" } },
      orderBy: { id: "desc" },
      take: 30,
      include: { ...requestInclude, trip: { select: { id: true } } },
    }),
  ]);
  const drivers = driverUsers.map((d) => ({ id: d.id, label: d.fullName }));
  const reservedBy = new Map(reserved.map((r) => [r.productId, r._sum.qtyPlanned ?? 0]));
  // Свободно: остаток склада минус уже обещанное незагруженным рейсам
  const free = (productId: number) =>
    (balances.get(productId) ?? 0) - (reservedBy.get(productId) ?? 0);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Заявки на завоз</h1>
        <a href="#new" className="btn">
          + Создать заявку
        </a>
      </div>

      {pending.length === 0 && (
        <p className="card mb-6 text-sm text-zinc-500">Новых заявок нет.</p>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {pending.map((r) => (
          <section key={r.id} className="card border-l-8 border-l-amber-500">
            <h2 className="h2">
              №{r.id} · {r.point.name}
            </h2>
            <p className="-mt-2 mb-3 text-sm text-zinc-500">
              {r.createdBy.fullName} · {formatDateTime(r.createdAt)}
              {r.comment && <span className="block text-zinc-800">«{r.comment}»</span>}
            </p>
            <ActionForm action={approveRequestAction} submitLabel="Утвердить и назначить рейс">
              <input type="hidden" name="requestId" value={r.id} />
              <table className="table">
                <thead>
                  <tr>
                    <th>Вид</th>
                    <th className="num">Просит</th>
                    <th className="num">Свободно на складе</th>
                    <th className="num">Утвердить</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.product.name}</td>
                      <td className="num">{i.qtyRequested}</td>
                      <td
                        className={`num ${free(i.productId) < i.qtyRequested ? "font-semibold text-red-600" : ""}`}
                      >
                        {free(i.productId)}
                      </td>
                      <td className="w-24">
                        <input
                          name={`qty_${i.productId}`}
                          type="number"
                          min={0}
                          defaultValue={Math.max(0, Math.min(i.qtyRequested, free(i.productId)))}
                          className="input num"
                          required
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <DriverSelect drivers={drivers} />
            </ActionForm>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-red-700">Отклонить заявку</summary>
              <ActionForm action={rejectRequestAction} submitLabel="Отклонить">
                <input type="hidden" name="requestId" value={r.id} />
                <label className="label mt-2">Причина (её увидит продавец)</label>
                <input name="reason" className="input" required />
              </ActionForm>
            </details>
          </section>
        ))}
      </div>

      <section id="new" className="card mb-6">
        <h2 className="h2">Создать заявку самому</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Выберите точку, количество и водителя. Рейс сразу появится у водителя, заявка от продавца
          не нужна.
        </p>
        <ActionForm
          action={createDeliveryAction}
          submitLabel="Создать заявку и назначить водителя"
          resetOnSuccess
          className="max-w-xl"
        >
          <label className="label">Точка</label>
          <select name="pointId" className="input mb-3" required defaultValue="">
            <option value="" disabled>
              Выберите точку
            </option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-[1fr_auto_7rem] items-center gap-x-3 gap-y-2">
            {products.map((p) => (
              <label key={p.id} className="contents">
                <span>{p.name}</span>
                <span className="text-sm text-zinc-500">свободно {free(p.id)}</span>
                <input
                  name={`qty_${p.id}`}
                  type="number"
                  min={0}
                  placeholder="0"
                  className="input num"
                />
              </label>
            ))}
          </div>
          <DriverSelect drivers={drivers} />
          <label className="label mt-3">Комментарий</label>
          <input name="comment" className="input" />
        </ActionForm>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Рассмотренные</h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Точка</th>
                <th>Кто создал</th>
                <th>Просили / утверждено</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td>{r.point.name}</td>
                  <td>{r.createdBy.fullName}</td>
                  <td>
                    {r.items
                      .map((i) => `${i.product.name}: ${i.qtyRequested} / ${i.qtyApproved ?? "–"}`)
                      .join(", ")}
                  </td>
                  <td>
                    {REQUEST_STATUS_LABEL[r.status]}
                    {r.trip && <span className="text-zinc-500"> · рейс №{r.trip.id}</span>}
                    {r.rejectReason && (
                      <span className="block text-zinc-500">{r.rejectReason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
