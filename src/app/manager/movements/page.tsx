import { MovementType, type Prisma } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, locationName, MOVEMENT_LABEL } from "@/lib/labels";
import { listLocations, listProducts } from "@/lib/queries";
import { correctionAction } from "../actions";

const PAGE_SIZE = 200;

type Search = { location?: string; product?: string; type?: string };

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole("MANAGER");
  const search = await searchParams;
  const locationId = Number(search.location) || undefined;
  const productId = Number(search.product) || undefined;
  const type =
    search.type && search.type in MovementType ? (search.type as MovementType) : undefined;

  const where: Prisma.MovementWhereInput = {
    productId,
    type,
    ...(locationId
      ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] }
      : {}),
  };
  const place = { include: { point: true, driver: true } } as const;

  const [products, locations, movements, count] = await Promise.all([
    listProducts(false),
    listLocations(),
    prisma.movement.findMany({
      where,
      orderBy: { id: "desc" },
      take: PAGE_SIZE,
      include: {
        product: { select: { name: true } },
        author: { select: { fullName: true } },
        from: place,
        to: place,
      },
    }),
    prisma.movement.count({ where }),
  ]);
  // Корректировать можно только реальные места: склад, водителей, точки
  const correctable = locations.filter(
    (l) => l.type === "WAREHOUSE" || l.type === "DRIVER" || l.type === "POINT",
  );

  return (
    <>
      <h1 className="h1">Журнал движений</h1>

      <form className="card mb-6 grid gap-3 sm:grid-cols-4" method="get">
        <div>
          <label className="label">Место</label>
          <select name="location" defaultValue={search.location ?? ""} className="input">
            <option value="">Все</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {locationName(l)}
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
          <label className="label">Тип</label>
          <select name="type" defaultValue={search.type ?? ""} className="input">
            <option value="">Все</option>
            {Object.values(MovementType).map((t) => (
              <option key={t} value={t}>
                {MOVEMENT_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-secondary min-h-11 w-full">Показать</button>
        </div>
      </form>

      <section className="card mb-6 overflow-x-auto">
        {movements.length === 0 ? (
          <p className="text-sm text-zinc-500">Записей нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Тип</th>
                <th>Вид</th>
                <th className="num">Кол-во</th>
                <th>Откуда</th>
                <th>Куда</th>
                <th>Кто</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                  <td className="whitespace-nowrap">{MOVEMENT_LABEL[m.type]}</td>
                  <td>{m.product.name}</td>
                  <td className="num">{m.qty}</td>
                  <td>{locationName(m.from)}</td>
                  <td>{locationName(m.to)}</td>
                  <td>{m.author.fullName}</td>
                  <td>{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {count > movements.length && (
          <p className="mt-3 text-sm text-zinc-500">
            Показаны последние {movements.length} из {count}. Уточните фильтр, чтобы увидеть
            более ранние записи.
          </p>
        )}
      </section>

      <section className="card max-w-xl">
        <h2 className="h2">Корректировка</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Записи журнала нельзя изменить или удалить. Ошибка исправляется новой записью с причиной;
          исходная запись остаётся в журнале.
        </p>
        <ActionForm
          action={correctionAction}
          submitLabel="Провести корректировку"
          resetOnSuccess
          confirm="Провести корректировку? Отменить её можно будет только новой корректировкой."
        >
          <label className="label">Что исправляем</label>
          <select name="kind" className="input mb-3" required>
            <option value="INVENTORY">Недостача или излишек (по факту пересчёта)</option>
            <option value="RECEIPT_ERROR">Ошибка при вводе прихода</option>
          </select>
          <label className="label">Место</label>
          <select name="locationId" className="input mb-3" required>
            {correctable.map((l) => (
              <option key={l.id} value={l.id}>
                {locationName(l)}
              </option>
            ))}
          </select>
          <label className="label">Вид</label>
          <select name="productId" className="input mb-3" required>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="label">
            Изменение количества (например, -3 если стало меньше, 2 если больше)
          </label>
          <input name="delta" type="number" className="input mb-3" required />
          <label className="label">Причина</label>
          <input name="reason" className="input" required />
        </ActionForm>
      </section>
    </>
  );
}
