import { ActionForm } from "@/components/ActionForm";
import { Chip, PageHeader, TripSteps } from "@/components/ui";
import { getAllBalances } from "@/domain/ledger";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { listProducts } from "@/lib/queries";
import { acceptReturnAction, cancelTripAction } from "../actions";

const cell = (n: number | null) => (n === null ? "–" : n);

export default async function DeliveriesPage() {
  await requireRole("MANAGER");
  const tripInclude = {
    driver: { select: { fullName: true } },
    point: { select: { name: true } },
    acceptedBy: { select: { fullName: true } },
    items: {
      include: { product: { select: { name: true } } },
      orderBy: { id: "asc" },
    },
  } as const;

  const [active, finished, driverLocations, balances, products] =
    await Promise.all([
      prisma.trip.findMany({
        where: {
          status: { in: ["ASSIGNED", "LOADED", "IN_TRANSIT", "DELIVERED"] },
        },
        orderBy: { id: "asc" },
        include: tripInclude,
      }),
      prisma.trip.findMany({
        where: { status: { in: ["ACCEPTED", "CANCELLED"] } },
        orderBy: { id: "desc" },
        take: 30,
        include: tripInclude,
      }),
      prisma.location.findMany({
        where: { type: "DRIVER" },
        include: { driver: { select: { id: true, fullName: true } } },
      }),
      getAllBalances(prisma),
      listProducts(false),
    ]);

  // Что сейчас числится за каждым водителем
  const onDrivers = driverLocations
    .map((loc) => ({
      driver: loc.driver!,
      // Рейсы, по которым товар ещё законно в машине
      busy: active.some(
        (t) => t.driverId === loc.driver!.id && t.status !== "ASSIGNED",
      ),
      items: products
        .map((p) => ({ product: p, qty: balances.get(loc.id)?.get(p.id) ?? 0 }))
        .filter((i) => i.qty !== 0),
    }))
    .filter((d) => d.items.length > 0);

  return (
    <>
      <PageHeader
        title="Доставка"
        hint="Кто что везёт прямо сейчас и что числится за водителями."
      />

      <h2 className="h2">Активные рейсы</h2>
      {active.length === 0 && (
        <p className="card mb-6 text-sm text-zinc-500">Активных рейсов нет.</p>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {active.map((t) => (
          <section key={t.id} className="card">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">
                №{t.id} · {t.point.name}
              </span>
              {t.status === "DELIVERED" && (
                <Chip tone="amber">Ждёт приёма продавцом</Chip>
              )}
            </p>
            <p className="mb-2 text-sm text-zinc-500">
              Водитель {t.driver.fullName} · назначен{" "}
              {formatDateTime(t.createdAt)}
            </p>
            <TripSteps status={t.status} />
            <TripItems items={t.items} />
            {t.status === "ASSIGNED" && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-red-700">
                  Отменить рейс
                </summary>
                <ActionForm
                  action={cancelTripAction}
                  submitLabel="Отменить рейс"
                >
                  <input type="hidden" name="tripId" value={t.id} />
                  <label className="label mt-2">Причина</label>
                  <input name="reason" className="input" required />
                </ActionForm>
              </details>
            )}
          </section>
        ))}
      </div>

      <h2 className="h2">Числится за водителями</h2>
      {onDrivers.length === 0 && (
        <p className="card mb-6 text-sm text-zinc-500">
          За водителями ничего не числится.
        </p>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {onDrivers.map((d) => (
          <section
            key={d.driver.id}
            className={`card ${d.busy ? "" : "border-l-8 border-l-red-500"}`}
          >
            <p className="text-lg font-semibold">{d.driver.fullName}</p>
            <p className="mb-2 text-sm text-zinc-500">
              {d.busy
                ? "В рейсе: товар в машине, это нормально."
                : "Незавершённых рейсов нет. Товар нужно вернуть на склад или разобрать недостачу."}
            </p>
            {d.busy ? (
              <>
                <ul className="mb-2">
                  {d.items.map((i) => (
                    <li
                      key={i.product.id}
                      className="flex justify-between py-1"
                    >
                      <span>{i.product.name}</span>
                      <span className="font-semibold tabular-nums">
                        {i.qty}
                      </span>
                    </li>
                  ))}
                </ul>
                <details>
                  <summary className="cursor-pointer text-sm text-zinc-500">
                    Принять часть товара на склад
                  </summary>
                  <ActionForm
                    action={acceptReturnAction}
                    submitLabel="Принять на склад"
                    confirm="Принять возврат на склад?"
                  >
                    <input type="hidden" name="driverId" value={d.driver.id} />
                    <div className="grid grid-cols-[1fr_auto_7rem] items-center gap-x-3 gap-y-2">
                      {d.items.map((i) => (
                        <label key={i.product.id} className="contents">
                          <span>{i.product.name}</span>
                          <span className="text-sm text-zinc-500">
                            числится {i.qty}
                          </span>
                          <input
                            name={`qty_${i.product.id}`}
                            type="number"
                            min={0}
                            max={i.qty}
                            placeholder="0"
                            className="input num"
                          />
                        </label>
                      ))}
                    </div>
                  </ActionForm>
                </details>
              </>
            ) : (
              <ActionForm
                action={acceptReturnAction}
                submitLabel="Принять на склад"
                confirm="Принять возврат на склад?"
              >
                <input type="hidden" name="driverId" value={d.driver.id} />
                <div className="grid grid-cols-[1fr_auto_7rem] items-center gap-x-3 gap-y-2">
                  {d.items.map((i) => (
                    <label key={i.product.id} className="contents">
                      <span>{i.product.name}</span>
                      <span className="text-sm text-zinc-500">
                        числится {i.qty}
                      </span>
                      <input
                        name={`qty_${i.product.id}`}
                        type="number"
                        min={0}
                        max={i.qty}
                        placeholder="0"
                        className="input num"
                      />
                    </label>
                  ))}
                </div>
              </ActionForm>
            )}
          </section>
        ))}
      </div>

      <section className="card overflow-x-auto">
        <h2 className="h2">Завершённые рейсы</h2>
        {finished.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Точка</th>
                <th>Водитель</th>
                <th>Принял</th>
                <th>Утверждено / загружено / выгружено / принято</th>
                <th>Когда</th>
              </tr>
            </thead>
            <tbody>
              {finished.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.point.name}</td>
                  <td>{t.driver.fullName}</td>
                  <td>{t.acceptedBy?.fullName ?? ""}</td>
                  <td>
                    {t.status === "CANCELLED"
                      ? "Отменён"
                      : t.items.map((i) => {
                          const bad =
                            i.qtyLoaded !== i.qtyPlanned ||
                            i.qtyReceived !== i.qtyUnloaded;
                          return (
                            <span
                              key={i.id}
                              className={`block ${bad ? "font-semibold text-red-600" : ""}`}
                            >
                              {i.product.name}: {i.qtyPlanned} /{" "}
                              {cell(i.qtyLoaded)} / {cell(i.qtyUnloaded)} /{" "}
                              {cell(i.qtyReceived)}
                            </span>
                          );
                        })}
                  </td>
                  <td className="whitespace-nowrap">
                    {t.acceptedAt ? formatDateTime(t.acceptedAt) : ""}
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

function TripItems({
  items,
}: {
  items: {
    id: number;
    qtyPlanned: number;
    qtyLoaded: number | null;
    qtyUnloaded: number | null;
    product: { name: string };
  }[];
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Вид</th>
          <th className="num">Утверждено</th>
          <th className="num">Загружено</th>
          <th className="num">Выгружено</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td>{i.product.name}</td>
            <td className="num">{i.qtyPlanned}</td>
            <td
              className={`num ${i.qtyLoaded !== null && i.qtyLoaded !== i.qtyPlanned ? "font-semibold text-red-600" : ""}`}
            >
              {cell(i.qtyLoaded)}
            </td>
            <td className="num">{cell(i.qtyUnloaded)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
