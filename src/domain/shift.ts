import { CountKind, LocationType, MovementType, Role, ShiftStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { createIncident } from "./incidents";
import { getBalances, postMovement, systemLocationId } from "./ledger";
import type { QtyLine } from "./warehouse";

export type CountDiff = {
  productId: number;
  name: string;
  expected: number;
  actual: number;
  diff: number;
};

// Блокирует смену на время операции: продажа и закрытие смены не пересекутся.
export async function lockShift(tx: Tx, shiftId: number) {
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM shifts WHERE id = ${shiftId} FOR UPDATE`;
  if (rows.length === 0) throw new DomainError("Смена не найдена");
  return tx.shift.findUniqueOrThrow({ where: { id: shiftId } });
}

// Незакрытая смена продавца (открытая или ожидающая сдачи денег).
export function currentShift(tx: Tx, sellerId: number) {
  return tx.shift.findFirst({ where: { sellerId, status: { not: ShiftStatus.CLOSED } } });
}

// Что продавец обязан пересчитать: все пересчитываемые виды,
// а также всё, что по учёту числится на точке.
export async function productsToCount(tx: Tx, pointLocationId: number) {
  const balances = await getBalances(tx, pointLocationId);
  const products = await tx.product.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return products.filter(
    (p) => (p.isCountable && p.isActive) || (balances.get(p.id) ?? 0) !== 0,
  );
}

// Пересчёт стволов. Продавец вводит факт, не видя учётного остатка.
// Учётный остаток точки к этому моменту равен:
//   утром  - вечернему факту прошлой смены (плюс всё, что провёл менеджер);
//   вечером - утреннему факту + принято за смену - продано - списано.
// Любая разница, даже в один ствол, проводится движением в «Недостачу» / из неё
// и создаёт инцидент. После пересчёта учётный остаток равен факту.
async function performCount(
  tx: Tx,
  input: {
    shiftId: number;
    pointId: number;
    sellerId: number;
    kind: CountKind;
    actual: QtyLine[];
    // кто сдавал точку накануне: нужен для ночного расхождения
    previousSellerId: number | null;
  },
): Promise<CountDiff[]> {
  const pointLoc = await tx.location.findUniqueOrThrow({ where: { pointId: input.pointId } });
  // Блокируем точку: пока идёт пересчёт, остаток на ней не меняется
  await tx.$queryRaw`SELECT id FROM locations WHERE id = ${pointLoc.id} FOR UPDATE`;
  const balances = await getBalances(tx, pointLoc.id);
  const products = await productsToCount(tx, pointLoc.id);

  const actualBy = new Map<number, number>();
  for (const line of input.actual) {
    if (!Number.isInteger(line.qty) || line.qty < 0) {
      throw new DomainError("Количество должно быть целым числом, не меньше нуля");
    }
    if (actualBy.has(line.productId)) throw new DomainError("Один и тот же вид указан дважды");
    actualBy.set(line.productId, line.qty);
  }
  if (products.some((p) => !actualBy.has(p.id))) {
    throw new DomainError("Введите количество по каждому виду. Если вида нет на точке, введите 0.");
  }

  const shortage = await systemLocationId(tx, LocationType.SHORTAGE);
  const count = await tx.stockCount.create({ data: { shiftId: input.shiftId, kind: input.kind } });
  const diffs: CountDiff[] = [];
  const morning = input.kind === CountKind.MORNING;

  for (const product of products) {
    const expected = balances.get(product.id) ?? 0;
    const actual = actualBy.get(product.id)!;
    const diff = actual - expected;
    await tx.stockCountItem.create({
      data: {
        countId: count.id,
        productId: product.id,
        qtyExpected: expected,
        qtyActual: actual,
        diff,
      },
    });
    if (diff === 0) continue;

    diffs.push({ productId: product.id, name: product.name, expected, actual, diff });
    await postMovement(tx, {
      type: MovementType.COUNT_ADJUSTMENT,
      productId: product.id,
      qty: Math.abs(diff),
      fromLocationId: diff < 0 ? pointLoc.id : shortage,
      toLocationId: diff < 0 ? shortage : pointLoc.id,
      authorId: input.sellerId,
      shiftId: input.shiftId,
      reason: `${morning ? "Утренний" : "Вечерний"} пересчёт: по учёту ${expected}, по факту ${actual}`,
    });
    const type = morning
      ? diff < 0
        ? "NIGHT_SHORTAGE"
        : "NIGHT_SURPLUS"
      : diff < 0
        ? "DAY_SHORTAGE"
        : "DAY_SURPLUS";
    await createIncident(tx, {
      type,
      shiftId: input.shiftId,
      pointId: input.pointId,
      // Дневное расхождение - на продавце смены. Ночное - между тем, кто сдал
      // точку вечером, и тем, кто принял её утром.
      userId: morning ? input.previousSellerId : input.sellerId,
      secondUserId: morning ? input.sellerId : null,
      productId: product.id,
      qty: diff,
      description: morning
        ? `${product.name}: вечером оставалось ${expected}, утром насчитано ${actual}`
        : `${product.name}: должно остаться ${expected}, насчитано ${actual}`,
    });
  }
  return diffs;
}

// Открытие смены утренним пересчётом. Пока он не введён, продажи недоступны.
export async function openShift(
  tx: Tx,
  sellerId: number,
  input: { pointId: number; actual: QtyLine[] },
) {
  const seller = await tx.user.findUnique({
    where: { id: sellerId },
    include: { points: { where: { pointId: input.pointId } } },
  });
  if (seller?.role !== Role.SELLER || !seller.isActive || seller.points.length === 0) {
    throw new DomainError("Вы не работаете на этой точке");
  }
  const point = await tx.point.findUnique({ where: { id: input.pointId } });
  if (!point?.isActive) throw new DomainError("Точка не найдена или закрыта");

  // Блокировка точки делает проверку «нет открытой смены» надёжной при двойном нажатии
  const pointLoc = await tx.location.findUniqueOrThrow({ where: { pointId: input.pointId } });
  await tx.$queryRaw`SELECT id FROM locations WHERE id = ${pointLoc.id} FOR UPDATE`;
  if (await currentShift(tx, sellerId)) throw new DomainError("У вас уже есть незакрытая смена");
  const busy = await tx.shift.findFirst({
    where: { pointId: input.pointId, status: { not: ShiftStatus.CLOSED } },
    include: { seller: { select: { fullName: true } } },
  });
  if (busy) {
    throw new DomainError(`На точке не закрыта смена продавца ${busy.seller.fullName}`);
  }
  const previous = await tx.shift.findFirst({
    where: { pointId: input.pointId, status: ShiftStatus.CLOSED },
    orderBy: { id: "desc" },
  });

  const shift = await tx.shift.create({ data: { pointId: input.pointId, sellerId } });
  const diffs = await performCount(tx, {
    shiftId: shift.id,
    pointId: input.pointId,
    sellerId,
    kind: CountKind.MORNING,
    actual: input.actual,
    previousSellerId: previous?.sellerId ?? null,
  });
  await audit(tx, sellerId, "shift.open", "shift", shift.id, { pointId: input.pointId, diffs });
  return { shift, diffs };
}

// Вечерний пересчёт: первый шаг закрытия смены. После него продажи недоступны.
export async function eveningCount(tx: Tx, sellerId: number, actual: QtyLine[]) {
  const current = await currentShift(tx, sellerId);
  if (!current) throw new DomainError("У вас нет открытой смены");
  const shift = await lockShift(tx, current.id);
  if (shift.status !== ShiftStatus.OPEN) {
    throw new DomainError("Вечерний пересчёт уже введён. Осталось сдать деньги.");
  }
  // Незавершённые дела исказили бы пересчёт: товар лежит на точке, а по учёту ещё нет
  const waiting = await tx.trip.count({ where: { pointId: shift.pointId, status: "DELIVERED" } });
  if (waiting > 0) throw new DomainError("Сначала примите доставку: водитель уже выгрузил товар");
  const cancels = await tx.sale.count({
    where: { shiftId: shift.id, cancelStatus: "REQUESTED" },
  });
  if (cancels > 0) {
    throw new DomainError("Менеджер ещё не ответил на запрос отмены продажи. Свяжитесь с ним.");
  }

  const writeoffs = await tx.writeoffRequest.count({
    where: { shiftId: shift.id, status: "PENDING" },
  });
  if (writeoffs > 0) {
    throw new DomainError("Менеджер ещё не ответил на запрос списания. Свяжитесь с ним.");
  }

  const diffs = await performCount(tx, {
    shiftId: shift.id,
    pointId: shift.pointId,
    sellerId,
    kind: CountKind.EVENING,
    actual,
    previousSellerId: null,
  });
  await tx.shift.update({
    where: { id: shift.id },
    data: { status: ShiftStatus.COUNTED, countedAt: new Date() },
  });
  await audit(tx, sellerId, "shift.count", "shift", shift.id, { diffs });
  return { shift, diffs };
}

// Сколько наличных должно быть в кассе по продажам смены (без отменённых).
export async function expectedCash(tx: Tx, shiftId: number) {
  const sum = await tx.sale.aggregate({
    where: { shiftId, payment: "CASH", cancelStatus: { not: "CANCELLED" } },
    _sum: { total: true },
  });
  return sum._sum.total ?? 0;
}

// Второй шаг закрытия: продавец вводит фактическую сумму наличных.
export async function closeShift(tx: Tx, sellerId: number, cashActual: number) {
  if (!Number.isInteger(cashActual) || cashActual < 0) {
    throw new DomainError("Введите сумму наличных целым числом");
  }
  const current = await currentShift(tx, sellerId);
  if (!current) throw new DomainError("У вас нет открытой смены");
  const shift = await lockShift(tx, current.id);
  if (shift.status !== ShiftStatus.COUNTED) {
    throw new DomainError("Сначала введите вечерний пересчёт");
  }

  const cashExpected = await expectedCash(tx, shift.id);
  const diff = cashActual - cashExpected;
  if (diff !== 0) {
    await createIncident(tx, {
      type: "CASH_MISMATCH",
      shiftId: shift.id,
      pointId: shift.pointId,
      userId: sellerId,
      amount: diff,
      description: `Наличные: по продажам ${cashExpected} ₽, сдано ${cashActual} ₽`,
    });
  }
  const closed = await tx.shift.update({
    where: { id: shift.id },
    data: { status: ShiftStatus.CLOSED, closedAt: new Date(), cashExpected, cashActual },
  });
  await audit(tx, sellerId, "shift.close", "shift", shift.id, { cashExpected, cashActual });
  return closed;
}

// Отметки менеджера после смены: деньги получены, стикеры сверены с продажами.
export async function confirmShiftCheck(
  tx: Tx,
  managerId: number,
  shiftId: number,
  what: "cash" | "stickers",
) {
  const shift = await lockShift(tx, shiftId);
  if (shift.status !== ShiftStatus.CLOSED) throw new DomainError("Смена ещё не закрыта");
  if (what === "cash") {
    if (shift.cashReceivedAt) throw new DomainError("Уже отмечено");
    await tx.shift.update({
      where: { id: shiftId },
      data: { cashReceivedAt: new Date(), cashReceivedById: managerId },
    });
  } else {
    if (shift.stickersCheckedAt) throw new DomainError("Уже отмечено");
    await tx.shift.update({
      where: { id: shiftId },
      data: { stickersCheckedAt: new Date(), stickersCheckedById: managerId },
    });
  }
  await audit(tx, managerId, `shift.${what}`, "shift", shiftId);
}
