import { LocationType, MovementType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { getBalances, postCorrection, postMovement, systemLocationId } from "./ledger";

export type QtyLine = { productId: number; qty: number };

// Приход на склад (закупка): поставщик -> склад.
export async function createReceipt(
  tx: Tx,
  input: { authorId: number; supplier?: string; comment?: string; items: QtyLine[] },
) {
  const items = input.items.filter((i) => i.qty !== 0);
  if (items.length === 0) throw new DomainError("Укажите количество хотя бы по одному виду");
  if (new Set(items.map((i) => i.productId)).size !== items.length) {
    throw new DomainError("Один и тот же вид указан дважды");
  }

  const supplier = await systemLocationId(tx, LocationType.SUPPLIER);
  const warehouse = await systemLocationId(tx, LocationType.WAREHOUSE);

  const receipt = await tx.purchaseReceipt.create({
    data: {
      supplier: input.supplier?.trim() ?? "",
      comment: input.comment?.trim() ?? "",
      createdById: input.authorId,
    },
  });
  for (const item of items) {
    // postMovement проверяет количество, поэтому строку закупки создаём после него
    await postMovement(tx, {
      type: MovementType.RECEIPT,
      productId: item.productId,
      qty: item.qty,
      fromLocationId: supplier,
      toLocationId: warehouse,
      authorId: input.authorId,
      receiptId: receipt.id,
    });
    await tx.purchaseItem.create({
      data: { receiptId: receipt.id, productId: item.productId, qty: item.qty },
    });
  }
  await audit(tx, input.authorId, "receipt.create", "purchase_receipt", receipt.id, { items });
  return receipt;
}

// Инвентаризация склада: менеджер вводит фактическое количество,
// разница с учётным остатком проводится корректировкой в недостачу / из неё.
export async function warehouseInventory(
  tx: Tx,
  input: { authorId: number; reason: string; actual: QtyLine[] },
) {
  const warehouse = await systemLocationId(tx, LocationType.WAREHOUSE);
  // Блокируем склад до чтения остатков, чтобы параллельная выдача не исказила разницу.
  await tx.$queryRaw`SELECT id FROM locations WHERE id = ${warehouse} FOR UPDATE`;
  const balances = await getBalances(tx, warehouse);

  const diffs: { productId: number; expected: number; actual: number; delta: number }[] = [];
  for (const line of input.actual) {
    if (!Number.isInteger(line.qty) || line.qty < 0) {
      throw new DomainError("Фактическое количество не может быть отрицательным");
    }
    const expected = balances.get(line.productId) ?? 0;
    const delta = line.qty - expected;
    if (delta !== 0) diffs.push({ productId: line.productId, expected, actual: line.qty, delta });
  }
  if (diffs.length > 0 && !input.reason.trim()) {
    throw new DomainError("Есть расхождения: укажите причину или комментарий");
  }
  for (const d of diffs) {
    await postCorrection(tx, {
      locationId: warehouse,
      productId: d.productId,
      delta: d.delta,
      kind: "INVENTORY",
      reason: `Инвентаризация склада: ${input.reason.trim()}`,
      authorId: input.authorId,
    });
  }
  await audit(tx, input.authorId, "warehouse.inventory", "location", warehouse, { diffs });
  return diffs;
}
