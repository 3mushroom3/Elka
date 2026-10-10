import { LocationType, MovementType, ShiftStatus, type WriteoffReason } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { getBalance, postMovement, systemLocationId } from "./ledger";
import { notifyLowStock, notifyManagers } from "./notify";
import { currentShift, lockShift } from "./shift";

// Запрос продавца на списание (брак, поломка, кража). Фото обязательно.
// Товар остаётся на учёте точки, пока менеджер не подтвердит.
export async function createWriteoff(
  tx: Tx,
  sellerId: number,
  input: {
    productId: number;
    qty: number;
    reason: WriteoffReason;
    comment?: string;
    photoId: number;
  },
) {
  const current = await currentShift(tx, sellerId);
  if (!current) throw new DomainError("Списание можно запросить только в открытой смене");
  const shift = await lockShift(tx, current.id);
  if (shift.status !== ShiftStatus.OPEN) {
    throw new DomainError("Вечерний пересчёт уже введён: списание в этой смене недоступно");
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new DomainError("Количество должно быть целым числом больше нуля");
  }
  const comment = input.comment?.trim() ?? "";
  if (input.reason === "OTHER" && !comment) {
    throw new DomainError("Опишите причину списания");
  }
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new DomainError("Вид товара не найден");
  const photo = await tx.attachment.findUnique({ where: { id: input.photoId } });
  if (!photo || photo.uploadedById !== sellerId) {
    throw new DomainError("Приложите фото: без него списание не принимается");
  }

  // Нельзя запросить списание больше, чем числится (с учётом уже поданных запросов)
  const pointLoc = await tx.location.findUniqueOrThrow({ where: { pointId: shift.pointId } });
  const balance = await getBalance(tx, pointLoc.id, product.id);
  const pending = await tx.writeoffRequest.aggregate({
    where: { pointId: shift.pointId, productId: product.id, status: "PENDING" },
    _sum: { qty: true },
  });
  if (input.qty > balance - (pending._sum.qty ?? 0)) {
    throw new DomainError(`${product.name}: на точке не числится столько для списания`);
  }

  const writeoff = await tx.writeoffRequest.create({
    data: {
      pointId: shift.pointId,
      shiftId: shift.id,
      authorId: sellerId,
      productId: product.id,
      qty: input.qty,
      reason: input.reason,
      comment,
      photoId: photo.id,
    },
  });
  await notifyManagers(tx, {
    type: "WRITEOFF_REQUEST",
    title: `Запрос на списание: ${product.name} × ${input.qty}`,
    body: comment,
    link: "/manager/writeoffs",
  });
  await audit(tx, sellerId, "writeoff.create", "writeoff", writeoff.id, {
    productId: product.id,
    qty: input.qty,
    reason: input.reason,
  });
  return writeoff;
}

// Решение менеджера. Только при одобрении товар уходит с точки в «Списано».
export async function decideWriteoff(
  tx: Tx,
  managerId: number,
  input: { writeoffId: number; approve: boolean; comment?: string },
) {
  const rows = await tx.$queryRaw<{ shift_id: number }[]>`
    SELECT shift_id FROM writeoff_requests WHERE id = ${input.writeoffId}`;
  if (rows.length === 0) throw new DomainError("Запрос на списание не найден");
  // Сначала смена, потом запрос: тот же порядок блокировок, что и при продаже
  await lockShift(tx, rows[0].shift_id);
  await tx.$queryRaw`SELECT id FROM writeoff_requests WHERE id = ${input.writeoffId} FOR UPDATE`;
  const writeoff = await tx.writeoffRequest.findUniqueOrThrow({
    where: { id: input.writeoffId },
  });
  if (writeoff.status !== "PENDING") throw new DomainError("Запрос уже рассмотрен");
  const comment = input.comment?.trim() ?? "";
  if (!input.approve && !comment) throw new DomainError("Укажите причину отказа");

  if (input.approve) {
    const pointLoc = await tx.location.findUniqueOrThrow({ where: { pointId: writeoff.pointId } });
    await postMovement(tx, {
      type: MovementType.WRITEOFF,
      productId: writeoff.productId,
      qty: writeoff.qty,
      fromLocationId: pointLoc.id,
      toLocationId: await systemLocationId(tx, LocationType.WRITTEN_OFF),
      authorId: managerId,
      shiftId: writeoff.shiftId,
      writeoffId: writeoff.id,
      reason: `Списание №${writeoff.id}`,
    });
    await notifyLowStock(tx, writeoff.pointId, writeoff.qty);
  }
  await tx.writeoffRequest.update({
    where: { id: writeoff.id },
    data: {
      status: input.approve ? "APPROVED" : "REJECTED",
      decidedById: managerId,
      decidedAt: new Date(),
      decisionComment: comment || null,
    },
  });
  await audit(
    tx,
    managerId,
    input.approve ? "writeoff.approve" : "writeoff.reject",
    "writeoff",
    writeoff.id,
    { comment },
  );
}
