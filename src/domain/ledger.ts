import { LocationType, MovementType, Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { DomainError } from "./errors";

// Места-источники, которым разрешён отрицательный остаток:
// поставщик (оттуда приходит товар) и недостача (оттуда возвращается излишек).
const UNBOUNDED_SOURCES: LocationType[] = [
  LocationType.SUPPLIER,
  LocationType.SHORTAGE,
];

export type MovementInput = {
  type: MovementType;
  productId: number;
  qty: number;
  fromLocationId: number;
  toLocationId: number;
  authorId: number;
  reason?: string | null;
  correctsMovementId?: number | null;
  receiptId?: number | null;
  tripId?: number | null;
  saleId?: number | null;
  shiftId?: number | null;
  writeoffId?: number | null;
  incidentId?: number | null;
};

export async function systemLocationId(tx: Tx, type: LocationType) {
  const loc = await tx.location.findFirst({
    where: { type, pointId: null, driverId: null },
    select: { id: true },
  });
  if (!loc) throw new Error(`Нет системного места ${type}`);
  return loc.id;
}

// Остаток места по товарам: входящие минус исходящие. Нигде не хранится.
export async function getBalances(tx: Tx, locationId: number) {
  const rows = await tx.$queryRaw<{ product_id: number; qty: bigint }[]>`
    SELECT product_id,
           SUM(CASE WHEN to_location_id = ${locationId} THEN qty ELSE -qty END) AS qty
    FROM movements
    WHERE to_location_id = ${locationId} OR from_location_id = ${locationId}
    GROUP BY product_id`;
  return new Map(rows.map((r) => [r.product_id, Number(r.qty)]));
}

export async function getBalance(tx: Tx, locationId: number, productId: number) {
  return (await getBalances(tx, locationId)).get(productId) ?? 0;
}

// Остатки сразу по всем местам: locationId -> productId -> qty
export async function getAllBalances(tx: Tx) {
  const rows = await tx.$queryRaw<
    { location_id: number; product_id: number; qty: bigint }[]
  >`
    SELECT location_id, product_id, SUM(qty) AS qty FROM (
      SELECT to_location_id AS location_id, product_id, qty FROM movements
      UNION ALL
      SELECT from_location_id, product_id, -qty FROM movements
    ) m
    GROUP BY location_id, product_id`;
  const result = new Map<number, Map<number, number>>();
  for (const r of rows) {
    if (!result.has(r.location_id)) result.set(r.location_id, new Map());
    result.get(r.location_id)!.set(r.product_id, Number(r.qty));
  }
  return result;
}

// Единственный способ изменить количество товара где-либо.
// Вызывать только внутри транзакции.
export async function postMovement(tx: Tx, input: MovementInput) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new DomainError("Количество должно быть целым числом больше нуля");
  }
  if (input.fromLocationId === input.toLocationId) {
    throw new DomainError("Место отправления и место назначения совпадают");
  }

  // Блокируем место-источник, чтобы два одновременных списания
  // не увели остаток в минус.
  const from = await tx.$queryRaw<{ id: number; type: LocationType }[]>`
    SELECT id, type FROM locations WHERE id = ${input.fromLocationId} FOR UPDATE`;
  if (from.length === 0) throw new DomainError("Место отправления не найдено");

  const bounded = !UNBOUNDED_SOURCES.includes(from[0].type);
  if (bounded) {
    const balance = await getBalance(tx, input.fromLocationId, input.productId);
    if (balance < input.qty) {
      throw new DomainError(
        `Недостаточно товара: в наличии ${balance}, требуется ${input.qty}`,
      );
    }
  }

  return tx.movement.create({
    data: {
      type: input.type,
      productId: input.productId,
      qty: input.qty,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      authorId: input.authorId,
      reason: input.reason ?? null,
      correctsMovementId: input.correctsMovementId ?? null,
      receiptId: input.receiptId ?? null,
      tripId: input.tripId ?? null,
      saleId: input.saleId ?? null,
      shiftId: input.shiftId ?? null,
      writeoffId: input.writeoffId ?? null,
      incidentId: input.incidentId ?? null,
    },
  });
}

export type CorrectionKind = "INVENTORY" | "RECEIPT_ERROR";

// Ручная корректировка менеджера. delta > 0: в месте стало больше, delta < 0: меньше.
// INVENTORY: разница уходит в недостачу / приходит из неё.
// RECEIPT_ERROR: исправление ошибочно введённого прихода (обратно поставщику / от него).
export async function postCorrection(
  tx: Tx,
  input: {
    locationId: number;
    productId: number;
    delta: number;
    kind: CorrectionKind;
    reason: string;
    authorId: number;
    correctsMovementId?: number | null;
  },
) {
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("Укажите причину корректировки");
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new DomainError("Изменение должно быть целым числом, не равным нулю");
  }
  const counterpart = await systemLocationId(
    tx,
    input.kind === "INVENTORY" ? LocationType.SHORTAGE : LocationType.SUPPLIER,
  );
  if (counterpart === input.locationId) {
    throw new DomainError("Это место нельзя корректировать");
  }
  return postMovement(tx, {
    type: MovementType.CORRECTION,
    productId: input.productId,
    qty: Math.abs(input.delta),
    fromLocationId: input.delta > 0 ? counterpart : input.locationId,
    toLocationId: input.delta > 0 ? input.locationId : counterpart,
    authorId: input.authorId,
    reason,
    correctsMovementId: input.correctsMovementId ?? null,
  });
}

// Проверка целостности: реальные места (склад, водители, точки) и итоговые
// (продано, списано) с отрицательным остатком. Список всегда должен быть пуст.
export async function findNegativeBalances(tx: Tx) {
  const rows = await tx.$queryRaw<
    { location_id: number; product_id: number; qty: bigint }[]
  >(Prisma.sql`
    SELECT m.location_id, m.product_id, SUM(m.qty) AS qty FROM (
      SELECT to_location_id AS location_id, product_id, qty FROM movements
      UNION ALL
      SELECT from_location_id, product_id, -qty FROM movements
    ) m
    JOIN locations l ON l.id = m.location_id
    WHERE l.type NOT IN ('SUPPLIER', 'SHORTAGE')
    GROUP BY m.location_id, m.product_id
    HAVING SUM(m.qty) < 0`);
  return rows.map((r) => ({
    locationId: r.location_id,
    productId: r.product_id,
    qty: Number(r.qty),
  }));
}
