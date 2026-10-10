import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createUser } from "@/domain/catalog";
import {
  acceptDelivery,
  confirmLoad,
  confirmUnload,
  createDelivery,
  depart,
} from "@/domain/delivery";
import { DomainError } from "@/domain/errors";
import { findNegativeBalances } from "@/domain/ledger";
import { decideSaleCancel, recordSale, requestSaleCancel, type SaleInput } from "@/domain/sales";
import { closeShift, confirmShiftCheck, eveningCount, openShift } from "@/domain/shift";
import { balance, type Basics, receive, resetDb, seedBasics, transfer } from "./helpers";

let b: Basics;

const tx = prisma.$transaction.bind(prisma) as typeof prisma.$transaction;
const lines = (pine: number, fir: number) => [
  { productId: b.pine.id, qty: pine },
  { productId: b.fir.id, qty: fir },
];
const open = (pine: number, fir: number, sellerId = b.seller.id) =>
  tx((t) => openShift(t, sellerId, { pointId: b.point.id, actual: lines(pine, fir) }));
const evening = (pine: number, fir: number, sellerId = b.seller.id) =>
  tx((t) => eveningCount(t, sellerId, lines(pine, fir)));
const close = (cash: number, sellerId = b.seller.id) => tx((t) => closeShift(t, sellerId, cash));
const sell = (input: Partial<SaleInput> = {}, sellerId = b.seller.id) =>
  tx((t) =>
    recordSale(t, sellerId, {
      productId: b.pine.id,
      qty: 1,
      stickerPrice: 2000,
      price: 2000,
      payment: "CASH",
      ...input,
    }),
  );
const incidents = () => prisma.incident.findMany({ orderBy: { id: "asc" } });

// Рейс со склада на точку, выгруженный и ждущий приёма
async function deliveredTrip(pine: number, fir: number) {
  const trip = await tx((t) =>
    createDelivery(t, b.manager.id, {
      pointId: b.point.id,
      driverId: b.driver.id,
      items: lines(pine, fir),
    }),
  );
  // В рейс попадают только виды с ненулевым количеством
  const loaded = lines(pine, fir).filter((l) => l.qty > 0);
  await tx((t) => confirmLoad(t, b.driver.id, trip.id, loaded));
  await tx((t) => depart(t, b.driver.id, trip.id));
  await tx((t) => confirmUnload(t, b.driver.id, trip.id, loaded));
  return trip;
}

async function secondSeller() {
  return tx((t) =>
    createUser(t, b.manager.id, {
      login: "seller2",
      fullName: "Сменщик",
      role: Role.SELLER,
      password: "secret123",
      pointIds: [b.point.id],
    }),
  );
}

// На складе 200 сосен и 100 пихт, на точке уже лежит 20 сосен и 10 пихт
beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  await receive(b, b.pine.id, 200);
  await receive(b, b.fir.id, 100);
  await transfer(b, b.pine.id, 20, b.loc.warehouse, b.loc.point);
  await transfer(b, b.fir.id, 10, b.loc.warehouse, b.loc.point);
});

describe("открытие смены", () => {
  it("без открытой смены продажа недоступна", async () => {
    await expect(sell()).rejects.toThrow("откройте смену");
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
  });

  it("утренний пересчёт без расхождений открывает смену без инцидентов", async () => {
    const { shift, diffs } = await open(20, 10);

    expect(shift.status).toBe("OPEN");
    expect(diffs).toEqual([]);
    expect(await incidents()).toEqual([]);
    const items = await prisma.stockCountItem.findMany({ orderBy: { productId: "asc" } });
    expect(items.map((i) => [i.qtyExpected, i.qtyActual, i.diff])).toEqual([
      [20, 20, 0],
      [10, 10, 0],
    ]);
    await sell();
  });

  it("нужно ввести количество по каждому виду", async () => {
    await expect(
      tx((t) =>
        openShift(t, b.seller.id, {
          pointId: b.point.id,
          actual: [{ productId: b.pine.id, qty: 20 }],
        }),
      ),
    ).rejects.toThrow(DomainError);
    await expect(open(-1, 10)).rejects.toThrow(DomainError);
    expect(await prisma.shift.count()).toBe(0);
  });

  it("на точке может быть только одна незакрытая смена", async () => {
    const other = await secondSeller();
    await open(20, 10);
    await expect(open(20, 10)).rejects.toThrow(DomainError);
    await expect(open(20, 10, other.id)).rejects.toThrow("не закрыта смена");
    expect(await prisma.shift.count()).toBe(1);
  });

  it("двойное нажатие не открывает две смены", async () => {
    const results = await Promise.allSettled([open(20, 10), open(20, 10)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.shift.count()).toBe(1);
    expect(await prisma.stockCount.count()).toBe(1);
  });

  it("чужой продавец и водитель не могут открыть смену на точке", async () => {
    const stranger = await tx((t) =>
      createUser(t, b.manager.id, {
        login: "stranger",
        fullName: "Чужой",
        role: Role.SELLER,
        password: "secret123",
        pointIds: [],
      }),
    );
    await expect(open(20, 10, stranger.id)).rejects.toThrow(DomainError);
    await expect(open(20, 10, b.driver.id)).rejects.toThrow(DomainError);
  });
});

describe("продажа", () => {
  beforeEach(async () => {
    await open(20, 10);
  });

  it("уменьшает остаток точки и попадает в «Продано»", async () => {
    const sale = await sell({ qty: 2 });

    expect(sale.total).toBe(4000);
    expect(await balance(b.loc.point, b.pine.id)).toBe(18);
    expect(await balance(b.loc.sold, b.pine.id)).toBe(2);
    const movement = await prisma.movement.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(movement).toMatchObject({ type: "SALE", qty: 2, authorId: b.seller.id });
  });

  it("процент продавцу: 10% с сосны, 5% с пихты", async () => {
    const pine = await sell({ price: 2000, stickerPrice: 2000 });
    const fir = await sell({ productId: b.fir.id, price: 3000, stickerPrice: 3000 });

    const items = await prisma.saleItem.findMany({
      where: { saleId: { in: [pine.id, fir.id] } },
      orderBy: { saleId: "asc" },
    });
    expect(items.map((i) => [i.commissionPercent, i.commission])).toEqual([
      [10, 200],
      [5, 150],
    ]);
  });

  it("нельзя продать больше, чем числится на точке", async () => {
    await expect(sell({ qty: 21 })).rejects.toThrow(DomainError);
    expect(await prisma.sale.count()).toBe(0);
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
    expect(await findNegativeBalances(prisma)).toEqual([]);
  });

  it("продажа ниже стикера требует причину и помечается для менеджера", async () => {
    await expect(sell({ price: 1500 })).rejects.toThrow("причину");
    const sale = await sell({ price: 1500, discountReason: "сломана ветка" });

    expect(sale.total).toBe(1500);
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "DISCOUNT",
      userId: b.seller.id,
      pointId: b.point.id,
      productId: b.pine.id,
      saleId: sale.id,
      amount: -500,
    });
  });

  it("продажа по цене стикера инцидент не создаёт", async () => {
    await sell();
    expect(await incidents()).toEqual([]);
  });

  it("цена выше стикера, нулевой стикер и дробное количество отклоняются", async () => {
    await expect(sell({ price: 2500 })).rejects.toThrow(DomainError);
    await expect(sell({ stickerPrice: 0, price: 0 })).rejects.toThrow(DomainError);
    await expect(sell({ qty: 1.5 })).rejects.toThrow(DomainError);
    await expect(sell({ qty: 0 })).rejects.toThrow(DomainError);
  });

  it("повторная отправка той же продажи не создаёт вторую", async () => {
    const first = await sell({ clientKey: "abc" });
    const second = await sell({ clientKey: "abc" });

    expect(second.id).toBe(first.id);
    expect(await prisma.sale.count()).toBe(1);
    expect(await balance(b.loc.point, b.pine.id)).toBe(19);
  });

  it("после вечернего пересчёта продажи закрыты", async () => {
    await evening(20, 10);
    await expect(sell()).rejects.toThrow(DomainError);
  });
});

describe("вечерний пересчёт", () => {
  it("ожидаемый остаток = утро + принято - продано", async () => {
    await open(20, 10);
    await sell({ qty: 3 });
    await sell({ productId: b.fir.id, stickerPrice: 3000, price: 3000 });
    const trip = await deliveredTrip(5, 0);
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, [{ productId: b.pine.id, qty: 5 }]));

    const { diffs } = await evening(22, 9);

    expect(diffs).toEqual([]);
    const count = await prisma.stockCount.findFirstOrThrow({
      where: { kind: "EVENING" },
      include: { items: { orderBy: { productId: "asc" } } },
    });
    // сосна: 20 + 5 - 3 = 22, пихта: 10 - 1 = 9
    expect(count.items.map((i) => [i.qtyExpected, i.qtyActual, i.diff])).toEqual([
      [22, 22, 0],
      [9, 9, 0],
    ]);
    expect(await incidents()).toEqual([]);
  });

  it("недостача в один ствол фиксируется инцидентом на продавца", async () => {
    await open(20, 10);
    await sell({ qty: 3 });
    const { shift, diffs } = await evening(16, 10);

    expect(diffs).toEqual([
      { productId: b.pine.id, name: "Сосна", expected: 17, actual: 16, diff: -1 },
    ]);
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "DAY_SHORTAGE",
      status: "OPEN",
      userId: b.seller.id,
      pointId: b.point.id,
      productId: b.pine.id,
      shiftId: shift.id,
      qty: -1,
    });
    // Пропавшая ёлка не исчезла из учёта, а числится в недостаче
    expect(await balance(b.loc.point, b.pine.id)).toBe(16);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(1);
  });

  it("излишек фиксируется отдельным типом инцидента", async () => {
    await open(20, 10);
    await evening(20, 12);

    const list = await incidents();
    expect(list.map((i) => [i.type, i.productId, i.qty])).toEqual([
      ["DAY_SURPLUS", b.fir.id, 2],
    ]);
    expect(await balance(b.loc.point, b.fir.id)).toBe(12);
    expect(await balance(b.loc.shortage, b.fir.id)).toBe(-2);
  });

  it("утреннее расхождение не попадает в вечернее: вечер считается от утреннего факта", async () => {
    await open(19, 10); // утром не хватает одной сосны
    await sell({ qty: 2 });
    const { diffs } = await evening(17, 10);

    expect(diffs).toEqual([]);
    const list = await incidents();
    expect(list.map((i) => i.type)).toEqual(["NIGHT_SHORTAGE"]);
  });

  it("нельзя ввести дважды", async () => {
    await open(20, 10);
    await evening(20, 10);
    await expect(evening(20, 10)).rejects.toThrow(DomainError);
    expect(await prisma.stockCount.count({ where: { kind: "EVENING" } })).toBe(1);
  });

  it("недоступен, пока не принята выгруженная доставка", async () => {
    await open(20, 10);
    const trip = await deliveredTrip(5, 0);
    await expect(evening(25, 10)).rejects.toThrow("примите доставку");

    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, [{ productId: b.pine.id, qty: 5 }]));
    expect((await evening(25, 10)).diffs).toEqual([]);
  });

  it("сумма по всем местам сохраняется после пересчётов с расхождениями", async () => {
    await open(19, 11);
    await sell({ qty: 4 });
    await evening(14, 12);

    for (const [productId, total] of [
      [b.pine.id, 200],
      [b.fir.id, 100],
    ]) {
      const sum =
        (await balance(b.loc.warehouse, productId)) +
        (await balance(b.loc.driver, productId)) +
        (await balance(b.loc.point, productId)) +
        (await balance(b.loc.sold, productId)) +
        (await balance(b.loc.shortage, productId));
      expect(sum).toBe(total);
    }
  });
});

describe("ночное расхождение", () => {
  it("фиксируется отдельно и привязано к обоим продавцам", async () => {
    const other = await secondSeller();
    await open(20, 10);
    await evening(20, 10);
    await close(0);

    const { shift, diffs } = await open(18, 10, other.id);

    expect(diffs).toEqual([
      { productId: b.pine.id, name: "Сосна", expected: 20, actual: 18, diff: -2 },
    ]);
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "NIGHT_SHORTAGE",
      pointId: b.point.id,
      userId: b.seller.id, // сдал точку вечером
      secondUserId: other.id, // принял утром
      productId: b.pine.id,
      shiftId: shift.id,
      qty: -2,
    });
    expect(await balance(b.loc.point, b.pine.id)).toBe(18);
  });

  it("утро сравнивается с вечерним фактом, а не с расчётом", async () => {
    await open(20, 10);
    await evening(19, 10); // вечером уже не хватало одной: это дневная недостача
    await close(0);
    const { diffs } = await open(19, 10);

    expect(diffs).toEqual([]);
    expect((await incidents()).map((i) => i.type)).toEqual(["DAY_SHORTAGE"]);
  });

  it("приём доставки без открытой смены невозможен", async () => {
    const trip = await deliveredTrip(5, 0);
    await expect(
      tx((t) => acceptDelivery(t, b.seller.id, trip.id, [{ productId: b.pine.id, qty: 5 }])),
    ).rejects.toThrow("открытой смене");
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
  });
});

describe("закрытие смены по деньгам", () => {
  beforeEach(async () => {
    await open(20, 10);
    await sell({ price: 2000, payment: "CASH" });
    await sell({ price: 2000, payment: "CASH" });
    await sell({ price: 2000, payment: "TRANSFER" });
    await sell({ productId: b.fir.id, stickerPrice: 3000, price: 3000, payment: "CARD" });
  });

  it("сначала пересчёт, потом деньги", async () => {
    await expect(close(4000)).rejects.toThrow("пересчёт");
  });

  it("ожидаются только наличные; совпадение не создаёт инцидент", async () => {
    await evening(17, 9);
    const shift = await close(4000);

    expect(shift).toMatchObject({ status: "CLOSED", cashExpected: 4000, cashActual: 4000 });
    expect(await incidents()).toEqual([]);
  });

  it("расхождение по деньгам фиксируется с суммой", async () => {
    await evening(17, 9);
    const shift = await close(3500);

    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "CASH_MISMATCH",
      userId: b.seller.id,
      pointId: b.point.id,
      shiftId: shift.id,
      amount: -500,
    });
  });

  it("закрытую смену нельзя закрыть ещё раз; после неё можно открыть новую", async () => {
    await evening(17, 9);
    await close(4000);
    await expect(close(4000)).rejects.toThrow(DomainError);
    await expect(sell()).rejects.toThrow(DomainError);
    await open(17, 9);
  });

  it("менеджер отмечает получение денег и сверку стикеров один раз", async () => {
    await evening(17, 9);
    const shift = await close(4000);
    await tx((t) => confirmShiftCheck(t, b.manager.id, shift.id, "cash"));
    await tx((t) => confirmShiftCheck(t, b.manager.id, shift.id, "stickers"));

    const saved = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(saved.cashReceivedById).toBe(b.manager.id);
    expect(saved.stickersCheckedById).toBe(b.manager.id);
    await expect(
      tx((t) => confirmShiftCheck(t, b.manager.id, shift.id, "cash")),
    ).rejects.toThrow(DomainError);
  });
});

describe("отмена продажи", () => {
  beforeEach(async () => {
    await open(20, 10);
  });

  it("продавец только запрашивает; до решения остаток не меняется и смену закрыть нельзя", async () => {
    const sale = await sell();
    await expect(tx((t) => requestSaleCancel(t, b.seller.id, sale.id, ""))).rejects.toThrow(
      DomainError,
    );
    await tx((t) => requestSaleCancel(t, b.seller.id, sale.id, "пробил не тот вид"));

    expect(await balance(b.loc.point, b.pine.id)).toBe(19);
    await expect(evening(19, 10)).rejects.toThrow("отмены");
  });

  it("одобренная отмена возвращает товар сторнирующей записью и убирает продажу из выручки", async () => {
    const sale = await sell();
    await sell();
    await tx((t) => requestSaleCancel(t, b.seller.id, sale.id, "пробил дважды"));
    await tx((t) => decideSaleCancel(t, b.manager.id, { saleId: sale.id, approve: true }));

    expect(await balance(b.loc.point, b.pine.id)).toBe(19);
    expect(await balance(b.loc.sold, b.pine.id)).toBe(1);
    const movements = await prisma.movement.findMany({
      where: { saleId: sale.id },
      orderBy: { id: "asc" },
    });
    expect(movements.map((m) => m.type)).toEqual(["SALE", "CORRECTION"]);
    expect(movements[1].correctsMovementId).toBe(movements[0].id);
    expect(movements[1].authorId).toBe(b.manager.id);

    expect((await evening(19, 10)).diffs).toEqual([]);
    expect((await close(2000)).cashExpected).toBe(2000);
    expect(await incidents()).toEqual([]);
  });

  it("отклонённая отмена ничего не меняет", async () => {
    const sale = await sell();
    await tx((t) => requestSaleCancel(t, b.seller.id, sale.id, "передумал"));
    await tx((t) =>
      decideSaleCancel(t, b.manager.id, { saleId: sale.id, approve: false, comment: "нет" }),
    );

    expect(await balance(b.loc.point, b.pine.id)).toBe(19);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).cancelStatus).toBe(
      "REJECTED",
    );
    await expect(
      tx((t) => decideSaleCancel(t, b.manager.id, { saleId: sale.id, approve: true })),
    ).rejects.toThrow(DomainError);
    await expect(
      tx((t) => requestSaleCancel(t, b.seller.id, sale.id, "ещё раз")),
    ).rejects.toThrow(DomainError);
  });

  it("нельзя запросить отмену чужой продажи", async () => {
    const other = await secondSeller();
    const sale = await sell();
    await expect(
      tx((t) => requestSaleCancel(t, other.id, sale.id, "не моя")),
    ).rejects.toThrow(DomainError);
  });
});
