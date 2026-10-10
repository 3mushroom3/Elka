import { LocationType, MovementType, type PaymentMethod, ShiftStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { createIncident } from "./incidents";
import { postMovement, systemLocationId } from "./ledger";
import { notifyLowStock, notifyManagers } from "./notify";
import { currentShift, lockShift } from "./shift";

export type SaleInput = {
  productId: number;
  qty: number;
  // цена на стикере и цена, по которой фактически продано (за штуку)
  stickerPrice: number;
  price: number;
  discountReason?: string;
  payment: PaymentMethod;
  // ключ от телефона: защищает от двойного нажатия и повторной отправки
  clientKey?: string;
};

export function commissionOf(price: number, qty: number, percent: number) {
  return Math.round((price * qty * percent) / 100);
}

// Продажа: товар уходит с точки в «Продано». Доступна только в открытой смене.
export async function recordSale(tx: Tx, sellerId: number, input: SaleInput) {
  const current = await currentShift(tx, sellerId);
  if (!current) throw new DomainError("Сначала откройте смену утренним пересчётом");
  const shift = await lockShift(tx, current.id);
  if (shift.status !== ShiftStatus.OPEN) {
    throw new DomainError("Вечерний пересчёт уже введён: продажи в этой смене закрыты");
  }
  if (input.clientKey) {
    const existing = await tx.sale.findUnique({ where: { clientKey: input.clientKey } });
    if (existing) return existing;
  }

  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new DomainError("Количество должно быть целым числом больше нуля");
  }
  if (!Number.isInteger(input.stickerPrice) || input.stickerPrice <= 0) {
    throw new DomainError("Укажите цену со стикера");
  }
  if (!Number.isInteger(input.price) || input.price < 0) {
    throw new DomainError("Укажите цену продажи");
  }
  if (input.price > input.stickerPrice) {
    throw new DomainError("Цена продажи не может быть выше цены на стикере");
  }
  const discounted = input.price < input.stickerPrice;
  const discountReason = input.discountReason?.trim() ?? "";
  if (discounted && !discountReason) {
    throw new DomainError("Продажа ниже цены стикера: укажите причину");
  }
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product?.isActive) throw new DomainError("Вид товара не найден");

  const total = input.price * input.qty;
  const sale = await tx.sale.create({
    data: {
      shiftId: shift.id,
      pointId: shift.pointId,
      sellerId,
      payment: input.payment,
      total,
      clientKey: input.clientKey ?? null,
      items: {
        create: {
          productId: product.id,
          qty: input.qty,
          stickerPrice: input.stickerPrice,
          price: input.price,
          discountReason: discounted ? discountReason : null,
          commissionPercent: product.commissionPercent,
          commission: commissionOf(input.price, input.qty, product.commissionPercent),
        },
      },
    },
  });

  const pointLoc = await tx.location.findUniqueOrThrow({ where: { pointId: shift.pointId } });
  // Продать больше, чем числится на точке, нельзя: postMovement это проверяет
  await postMovement(tx, {
    type: MovementType.SALE,
    productId: product.id,
    qty: input.qty,
    fromLocationId: pointLoc.id,
    toLocationId: await systemLocationId(tx, LocationType.SOLD),
    authorId: sellerId,
    saleId: sale.id,
    shiftId: shift.id,
  });

  await notifyLowStock(tx, shift.pointId, input.qty);

  if (discounted) {
    await createIncident(tx, {
      type: "DISCOUNT",
      saleId: sale.id,
      shiftId: shift.id,
      pointId: shift.pointId,
      userId: sellerId,
      productId: product.id,
      qty: input.qty,
      amount: (input.price - input.stickerPrice) * input.qty,
      description: `${product.name}: стикер ${input.stickerPrice} ₽, продано за ${input.price} ₽. Причина: ${discountReason}`,
    });
  }
  await audit(tx, sellerId, "sale.create", "sale", sale.id, {
    productId: product.id,
    qty: input.qty,
    stickerPrice: input.stickerPrice,
    price: input.price,
    payment: input.payment,
  });
  return sale;
}

// Продавец не может сам отменить или исправить продажу: только попросить менеджера.
export async function requestSaleCancel(tx: Tx, sellerId: number, saleId: number, reason: string) {
  const text = reason.trim();
  if (!text) throw new DomainError("Укажите причину отмены");
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM sales WHERE id = ${saleId} FOR UPDATE`;
  const sale = rows.length ? await tx.sale.findUnique({ where: { id: saleId } }) : null;
  if (!sale || sale.sellerId !== sellerId) throw new DomainError("Продажа не найдена");
  if (sale.cancelStatus !== "NONE") throw new DomainError("По этой продаже уже был запрос отмены");
  const shift = await tx.shift.findUniqueOrThrow({ where: { id: sale.shiftId } });
  if (shift.status !== ShiftStatus.OPEN) {
    throw new DomainError("Отмену можно запросить только до вечернего пересчёта");
  }
  await tx.sale.update({
    where: { id: saleId },
    data: { cancelStatus: "REQUESTED", cancelReason: text, cancelRequestedAt: new Date() },
  });
  await notifyManagers(tx, {
    type: "SALE_CANCEL_REQUEST",
    title: `Запрос отмены продажи №${saleId}`,
    body: text,
    link: "/manager/sales",
  });
  await audit(tx, sellerId, "sale.cancel_request", "sale", saleId, { reason: text });
}

// Решение менеджера. При отмене товар возвращается на точку сторнирующей записью,
// исходная продажа и её движение остаются в истории.
export async function decideSaleCancel(
  tx: Tx,
  managerId: number,
  input: { saleId: number; approve: boolean; comment?: string },
) {
  const rows = await tx.$queryRaw<{ shift_id: number }[]>`
    SELECT shift_id FROM sales WHERE id = ${input.saleId}`;
  if (rows.length === 0) throw new DomainError("Продажа не найдена");
  // Сначала смена, потом продажа: тот же порядок блокировок, что и при продаже
  await lockShift(tx, rows[0].shift_id);
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${input.saleId} FOR UPDATE`;
  const sale = await tx.sale.findUniqueOrThrow({
    where: { id: input.saleId },
    include: { items: true, movements: { where: { type: MovementType.SALE } } },
  });
  if (sale.cancelStatus !== "REQUESTED") throw new DomainError("Запрос уже рассмотрен");

  if (input.approve) {
    for (const movement of sale.movements) {
      await postMovement(tx, {
        type: MovementType.CORRECTION,
        productId: movement.productId,
        qty: movement.qty,
        fromLocationId: movement.toLocationId,
        toLocationId: movement.fromLocationId,
        authorId: managerId,
        saleId: sale.id,
        shiftId: sale.shiftId,
        correctsMovementId: movement.id,
        reason: `Отмена продажи №${sale.id}: ${sale.cancelReason ?? ""}`,
      });
    }
  }
  await tx.sale.update({
    where: { id: sale.id },
    data: {
      cancelStatus: input.approve ? "CANCELLED" : "REJECTED",
      cancelDecidedById: managerId,
      cancelDecidedAt: new Date(),
      cancelComment: input.comment?.trim() || null,
    },
  });
  await audit(
    tx,
    managerId,
    input.approve ? "sale.cancel_approve" : "sale.cancel_reject",
    "sale",
    sale.id,
  );
}
