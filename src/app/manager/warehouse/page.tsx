import { LocationType } from "@prisma/client";
import { PageHeader, Qty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { getBalances, systemLocationId } from "@/domain/ledger";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { listProducts } from "@/lib/queries";
import { inventoryAction, receiptAction } from "../actions";

export default async function WarehousePage() {
  await requireRole("MANAGER");
  const warehouseId = await systemLocationId(prisma, LocationType.WAREHOUSE);
  const [products, balances, receipts] = await Promise.all([
    listProducts(),
    getBalances(prisma, warehouseId),
    prisma.purchaseReceipt.findMany({
      orderBy: { id: "desc" },
      take: 20,
      include: {
        createdBy: { select: { fullName: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    }),
  ]);
  const total = products.reduce((sum, p) => sum + (balances.get(p.id) ?? 0), 0);

  const inStock = products.filter((p) => (balances.get(p.id) ?? 0) !== 0);
  const outOfStock = products.filter((p) => (balances.get(p.id) ?? 0) === 0);

  return (
    <>
      <PageHeader
        title="Склад"
        hint="Сколько товара на складе. Здесь оформляется приход от поставщика и сверка с фактом."
      />

      <section className="card mb-6">
        <h2 className="h2">Остатки</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Вид</th>
              <th className="num">Количество</th>
            </tr>
          </thead>
          <tbody>
            {inStock.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num">
                  <Qty value={balances.get(p.id) ?? 0} />
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>Всего</td>
              <td className="num">{total}</td>
            </tr>
          </tbody>
        </table>
        {outOfStock.length > 0 && (
          <p className="mt-3 text-sm text-zinc-500">
            Нет на складе: {outOfStock.map((p) => p.name).join(", ")}.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="h2">Приход (закупка)</h2>
          <ActionForm
            action={receiptAction}
            submitLabel="Провести приход"
            resetOnSuccess
          >
            <label className="label">Поставщик</label>
            <input name="supplier" className="input mb-3" />
            <div className="grid grid-cols-[1fr_7rem] items-center gap-2">
              {products.map((p) => (
                <label key={p.id} className="contents">
                  <span>{p.name}</span>
                  <input
                    name={`qty_${p.id}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    className="input num"
                  />
                </label>
              ))}
            </div>
            <label className="label mt-3">Комментарий</label>
            <input name="comment" className="input" />
          </ActionForm>
        </section>

        <section className="card">
          <h2 className="h2">Инвентаризация</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Введите, сколько фактически лежит на складе. Разница с учётом будет
            проведена корректировкой и останется в журнале.
          </p>
          <ActionForm
            action={inventoryAction}
            submitLabel="Сверить с учётом"
            resetOnSuccess
            confirm="Провести инвентаризацию? Расхождения будут записаны в журнал."
          >
            <div className="grid grid-cols-[1fr_7rem] items-center gap-2">
              {products
                .filter((p) => p.isCountable)
                .map((p) => (
                  <label key={p.id} className="contents">
                    <span>{p.name}</span>
                    <input
                      name={`actual_${p.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      required
                      className="input num"
                    />
                  </label>
                ))}
            </div>
            <label className="label mt-3">
              Причина расхождения или комментарий
            </label>
            <input name="reason" className="input" />
          </ActionForm>
        </section>
      </div>

      <section className="card mt-6 overflow-x-auto">
        <h2 className="h2">Последние приходы</h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-zinc-500">Приходов пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Поставщик</th>
                <th>Состав</th>
                <th>Кто ввёл</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-nowrap">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td>{r.supplier}</td>
                  <td>
                    {r.items
                      .map((i) => `${i.product.name}: ${i.qty}`)
                      .join(", ")}
                    {r.comment && (
                      <span className="block text-zinc-500">{r.comment}</span>
                    )}
                  </td>
                  <td>{r.createdBy.fullName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
