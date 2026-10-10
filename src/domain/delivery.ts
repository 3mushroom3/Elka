import { LocationType, MovementType, Role, TripStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { createIncident } from "./incidents";
import { getBalances, postMovement, systemLocationId } from "./ledger";
import { notifyManagers } from "./notify";
import { lockShift } from "./shift";
import type { QtyLine } from "./warehouse";

function checkLines(items: QtyLine[]) {
  for (const i of items) {
    if (!Number.isInteger(i.qty) || i.qty < 0) {
      throw new DomainError("Количество должно быть целым числом, не меньше нуля");
    }
  }
  if (new Set(items.map((i) => i.productId)).size !== items.length) {
    throw new DomainError("Один и тот же вид указан дважды");
  }
}

async function checkActiveProducts(tx: Tx, productIds: number[]) {
  const found = await tx.product.count({ where: { id: { in: productIds }, isActive: true } });
  if (found !== productIds.length) throw new DomainError("В списке есть неизвестный вид товара");
}

async function sellerWorksAt(tx: Tx, sellerId: number, pointId: number) {
  const user = await tx.user.findUnique({
    where: { id: sellerId },
    include: { points: { where: { pointId } } },
  });
  return user?.role === Role.SELLER && user.isActive && user.points.length > 0;
}

// Блокирует рейс на время перехода между статусами: повторное нажатие
// кнопки не проведёт одно и то же действие дважды.
async function lockTrip(tx: Tx, tripId: number) {
  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM trips WHERE id = ${tripId} FOR UPDATE`;
  if (locked.length === 0) throw new DomainError("Рейс не найден");
  return tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { items: { include: { product: { select: { name: true } } } } },
  });
}

type LockedTrip = Awaited<ReturnType<typeof lockTrip>>;

function expectStatus(trip: LockedTrip, status: TripStatus) {
  if (trip.status !== status) {
    throw new DomainError("Это действие уже выполнено или сейчас недоступно. Обновите страницу.");
  }
}

function expectDriver(trip: LockedTrip, driverId: number) {
  if (trip.driverId !== driverId) throw new DomainError("Этот рейс назначен другому водителю");
}

// Количества должны быть указаны ровно по тем видам, что есть в рейсе.
function matchTripItems(trip: LockedTrip, items: QtyLine[]) {
  checkLines(items);
  const byProduct = new Map(items.map((i) => [i.productId, i.qty]));
  if (byProduct.size !== trip.items.length || trip.items.some((t) => !byProduct.has(t.productId))) {
    throw new DomainError("Укажите количество по каждому виду из рейса");
  }
  return trip.items.map((item) => ({ item, qty: byProduct.get(item.productId)! }));
}

// ---------- Заявка ----------

// Заявка продавца на завоз.
export async function createRequest(
  tx: Tx,
  sellerId: number,
  input: { pointId: number; items: QtyLine[]; comment?: string },
) {
  if (!(await sellerWorksAt(tx, sellerId, input.pointId))) {
    throw new DomainError("Вы не работаете на этой точке");
  }
  const request = await insertRequest(tx, sellerId, input);
  const point = await tx.point.findUniqueOrThrow({ where: { id: input.pointId } });
  await notifyManagers(tx, {
    type: "NEW_REQUEST",
    title: `Новая заявка на завоз: ${point.name}`,
    body: `Заявка №${request.id}${request.comment ? `: ${request.comment}` : ""}`,
    link: "/manager/requests",
  });
  return request;
}

async function insertRequest(
  tx: Tx,
  authorId: number,
  input: { pointId: number; items: QtyLine[]; comment?: string },
) {
  checkLines(input.items);
  const items = input.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new DomainError("Укажите количество хотя бы по одному виду");
  await checkActiveProducts(
    tx,
    items.map((i) => i.productId),
  );
  const point = await tx.point.findUnique({ where: { id: input.pointId } });
  if (!point?.isActive) throw new DomainError("Точка не найдена или закрыта");

  const request = await tx.deliveryRequest.create({
    data: {
      pointId: input.pointId,
      createdById: authorId,
      comment: input.comment?.trim() ?? "",
      items: { create: items.map((i) => ({ productId: i.productId, qtyRequested: i.qty })) },
    },
  });
  await audit(tx, authorId, "request.create", "delivery_request", request.id, {
    pointId: input.pointId,
    items,
  });
  return request;
}

// Менеджер утверждает количества и назначает водителя: создаётся рейс.
export async function approveRequest(
  tx: Tx,
  managerId: number,
  input: { requestId: number; driverId: number; items: QtyLine[] },
) {
  const locked = await tx.$queryRaw<{ status: string; point_id: number }[]>`
    SELECT status, point_id FROM delivery_requests WHERE id = ${input.requestId} FOR UPDATE`;
  if (locked.length === 0) throw new DomainError("Заявка не найдена");
  if (locked[0].status !== "NEW") throw new DomainError("Заявка уже рассмотрена");

  checkLines(input.items);
  const items = input.items.filter((i) => i.qty > 0);
  if (items.length === 0) {
    throw new DomainError("Утвердите количество хотя бы по одному виду или отклоните заявку");
  }
  await checkActiveProducts(
    tx,
    items.map((i) => i.productId),
  );
  const driver = await tx.user.findUnique({ where: { id: input.driverId } });
  if (!driver || driver.role !== Role.DRIVER || !driver.isActive) {
    throw new DomainError("Выберите водителя");
  }

  // Свободно на складе = остаток минус то, что уже обещано другим рейсам и ещё не загружено.
  const warehouse = await systemLocationId(tx, LocationType.WAREHOUSE);
  await tx.$queryRaw`SELECT id FROM locations WHERE id = ${warehouse} FOR UPDATE`;
  const balances = await getBalances(tx, warehouse);
  const reserved = await tx.tripItem.groupBy({
    by: ["productId"],
    where: { trip: { status: TripStatus.ASSIGNED } },
    _sum: { qtyPlanned: true },
  });
  const reservedBy = new Map(reserved.map((r) => [r.productId, r._sum.qtyPlanned ?? 0]));
  for (const item of items) {
    const free = (balances.get(item.productId) ?? 0) - (reservedBy.get(item.productId) ?? 0);
    if (item.qty > free) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
      throw new DomainError(
        `${product.name}: на складе свободно ${Math.max(free, 0)}, утверждено ${item.qty}`,
      );
    }
  }

  for (const item of items) {
    await tx.requestItem.upsert({
      where: { requestId_productId: { requestId: input.requestId, productId: item.productId } },
      update: { qtyApproved: item.qty },
      create: {
        requestId: input.requestId,
        productId: item.productId,
        qtyRequested: 0,
        qtyApproved: item.qty,
      },
    });
  }
  await tx.requestItem.updateMany({
    where: { requestId: input.requestId, qtyApproved: null },
    data: { qtyApproved: 0 },
  });
  await tx.deliveryRequest.update({
    where: { id: input.requestId },
    data: { status: "APPROVED", decidedById: managerId, decidedAt: new Date() },
  });
  const trip = await tx.trip.create({
    data: {
      requestId: input.requestId,
      driverId: input.driverId,
      pointId: locked[0].point_id,
      items: { create: items.map((i) => ({ productId: i.productId, qtyPlanned: i.qty })) },
    },
  });
  await audit(tx, managerId, "request.approve", "delivery_request", input.requestId, {
    tripId: trip.id,
    driverId: input.driverId,
    items,
  });
  return trip;
}

// Завоз по инициативе менеджера, без заявки продавца.
export async function createDelivery(
  tx: Tx,
  managerId: number,
  input: { pointId: number; driverId: number; items: QtyLine[]; comment?: string },
) {
  const request = await insertRequest(tx, managerId, input);
  return approveRequest(tx, managerId, {
    requestId: request.id,
    driverId: input.driverId,
    items: input.items,
  });
}

export async function rejectRequest(
  tx: Tx,
  managerId: number,
  requestId: number,
  reason: string,
) {
  const text = reason.trim();
  if (!text) throw new DomainError("Укажите причину отказа");
  const locked = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM delivery_requests WHERE id = ${requestId} FOR UPDATE`;
  if (locked.length === 0) throw new DomainError("Заявка не найдена");
  if (locked[0].status !== "NEW") throw new DomainError("Заявка уже рассмотрена");
  await tx.deliveryRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      rejectReason: text,
      decidedById: managerId,
      decidedAt: new Date(),
    },
  });
  await audit(tx, managerId, "request.reject", "delivery_request", requestId, { reason: text });
}

// Отменить рейс можно, только пока водитель ничего не загрузил.
export async function cancelTrip(tx: Tx, managerId: number, tripId: number, reason: string) {
  const text = reason.trim();
  if (!text) throw new DomainError("Укажите причину отмены");
  const trip = await lockTrip(tx, tripId);
  if (trip.status !== TripStatus.ASSIGNED) {
    throw new DomainError("Рейс уже загружен: отменить его нельзя");
  }
  await tx.trip.update({ where: { id: tripId }, data: { status: TripStatus.CANCELLED } });
  await tx.deliveryRequest.update({
    where: { id: trip.requestId },
    data: { status: "CANCELLED", rejectReason: text },
  });
  await audit(tx, managerId, "trip.cancel", "trip", tripId, { reason: text });
}

// ---------- Рейс ----------

// Водитель на складе подтверждает, сколько фактически загрузил.
// Товар переходит со склада на водителя по его цифре.
export async function confirmLoad(tx: Tx, driverId: number, tripId: number, items: QtyLine[]) {
  const trip = await lockTrip(tx, tripId);
  expectDriver(trip, driverId);
  expectStatus(trip, TripStatus.ASSIGNED);
  const lines = matchTripItems(trip, items);
  if (lines.every((l) => l.qty === 0)) {
    throw new DomainError("Ничего не загружено. Если рейс не нужен, сообщите менеджеру.");
  }

  const warehouse = await systemLocationId(tx, LocationType.WAREHOUSE);
  const driverLoc = await tx.location.findUniqueOrThrow({ where: { driverId } });
  for (const { item, qty } of lines) {
    if (qty > 0) {
      await postMovement(tx, {
        type: MovementType.TRANSFER,
        productId: item.productId,
        qty,
        fromLocationId: warehouse,
        toLocationId: driverLoc.id,
        authorId: driverId,
        tripId,
      });
    }
    await tx.tripItem.update({ where: { id: item.id }, data: { qtyLoaded: qty } });
    if (qty !== item.qtyPlanned) {
      await createIncident(tx, {
        type: "LOAD_MISMATCH",
        tripId,
        pointId: trip.pointId,
        userId: driverId,
        productId: item.productId,
        qty: qty - item.qtyPlanned,
        description: `${item.product.name}: утверждено ${item.qtyPlanned}, водитель загрузил ${qty}`,
      });
    }
  }
  await tx.trip.update({
    where: { id: tripId },
    data: { status: TripStatus.LOADED, loadedAt: new Date() },
  });
  await audit(tx, driverId, "trip.load", "trip", tripId, { items });
}

export async function depart(tx: Tx, driverId: number, tripId: number) {
  const trip = await lockTrip(tx, tripId);
  expectDriver(trip, driverId);
  expectStatus(trip, TripStatus.LOADED);
  await tx.trip.update({
    where: { id: tripId },
    data: { status: TripStatus.IN_TRANSIT, departedAt: new Date() },
  });
  await audit(tx, driverId, "trip.depart", "trip", tripId);
}

// Водитель на точке отмечает, сколько выгрузил. Товар ещё числится на нём,
// пока продавец не подтвердит приём.
export async function confirmUnload(tx: Tx, driverId: number, tripId: number, items: QtyLine[]) {
  const trip = await lockTrip(tx, tripId);
  expectDriver(trip, driverId);
  expectStatus(trip, TripStatus.IN_TRANSIT);
  const lines = matchTripItems(trip, items);
  for (const { item, qty } of lines) {
    if (qty > (item.qtyLoaded ?? 0)) {
      throw new DomainError(
        `${item.product.name}: выгружено ${qty}, а загружено было ${item.qtyLoaded ?? 0}`,
      );
    }
    await tx.tripItem.update({ where: { id: item.id }, data: { qtyUnloaded: qty } });
  }
  await tx.trip.update({
    where: { id: tripId },
    data: { status: TripStatus.DELIVERED, deliveredAt: new Date() },
  });
  await audit(tx, driverId, "trip.unload", "trip", tripId, { items });
}

// Продавец подтверждает, сколько фактически принял (не видя цифру водителя).
// Товар переходит с водителя на точку по цифре продавца, но не больше загруженного.
export async function acceptDelivery(tx: Tx, sellerId: number, tripId: number, items: QtyLine[]) {
  const trip = await lockTrip(tx, tripId);
  if (!(await sellerWorksAt(tx, sellerId, trip.pointId))) {
    throw new DomainError("Вы не работаете на этой точке");
  }
  expectStatus(trip, TripStatus.DELIVERED);
  // Принятое должно попасть в расчёт вечернего остатка этой смены,
  // поэтому приём возможен только в открытой смене на этой точке.
  const open = await tx.shift.findFirst({
    where: { sellerId, pointId: trip.pointId, status: "OPEN" },
  });
  if (!open) throw new DomainError("Принять доставку можно только в открытой смене");
  await lockShift(tx, open.id);
  const lines = matchTripItems(trip, items);

  const driverLoc = await tx.location.findUniqueOrThrow({ where: { driverId: trip.driverId } });
  const pointLoc = await tx.location.findUniqueOrThrow({ where: { pointId: trip.pointId } });
  for (const { item, qty } of lines) {
    const loaded = item.qtyLoaded ?? 0;
    const unloaded = item.qtyUnloaded ?? 0;
    const moved = Math.min(qty, loaded);
    if (moved > 0) {
      await postMovement(tx, {
        type: MovementType.TRANSFER,
        productId: item.productId,
        qty: moved,
        fromLocationId: driverLoc.id,
        toLocationId: pointLoc.id,
        authorId: sellerId,
        tripId,
        shiftId: open.id,
      });
    }
    await tx.tripItem.update({ where: { id: item.id }, data: { qtyReceived: qty } });
    if (qty !== unloaded) {
      let description = `${item.product.name}: водитель выгрузил ${unloaded}, продавец принял ${qty}`;
      if (qty > loaded) {
        description += `. Загружено было ${loaded}, на точку проведено ${moved}`;
      }
      await createIncident(tx, {
        type: "DELIVERY_MISMATCH",
        tripId,
        shiftId: open.id,
        pointId: trip.pointId,
        userId: trip.driverId,
        secondUserId: sellerId,
        productId: item.productId,
        qty: qty - unloaded,
        description,
      });
    }
  }
  await tx.trip.update({
    where: { id: tripId },
    data: { status: TripStatus.ACCEPTED, acceptedAt: new Date(), acceptedById: sellerId },
  });
  await tx.deliveryRequest.update({ where: { id: trip.requestId }, data: { status: "DONE" } });
  await audit(tx, sellerId, "trip.accept", "trip", tripId, { items });
}

// Менеджер принимает на склад то, что осталось у водителя.
export async function acceptReturn(
  tx: Tx,
  managerId: number,
  input: { driverId: number; items: QtyLine[] },
) {
  checkLines(input.items);
  const items = input.items.filter((i) => i.qty > 0);
  if (items.length === 0) throw new DomainError("Укажите, сколько принято на склад");
  const driverLoc = await tx.location.findUnique({ where: { driverId: input.driverId } });
  if (!driverLoc) throw new DomainError("Водитель не найден");
  const warehouse = await systemLocationId(tx, LocationType.WAREHOUSE);
  for (const item of items) {
    await postMovement(tx, {
      type: MovementType.TRANSFER,
      productId: item.productId,
      qty: item.qty,
      fromLocationId: driverLoc.id,
      toLocationId: warehouse,
      authorId: managerId,
      reason: "Возврат на склад",
    });
  }
  await audit(tx, managerId, "driver.return", "user", input.driverId, { items });
}
