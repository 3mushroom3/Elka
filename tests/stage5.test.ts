import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createRequest } from "@/domain/delivery";
import { checkShiftDeadlines } from "@/domain/deadlines";
import { salesReport } from "@/domain/reports";
import { decideSaleCancel, recordSale, requestSaleCancel, type SaleInput } from "@/domain/sales";
import { closeShift, eveningCount, openShift } from "@/domain/shift";
import { updateUser } from "@/domain/catalog";
import { type Basics, receive, resetDb, seedBasics, transfer } from "./helpers";

let b: Basics;

const tx = prisma.$transaction.bind(prisma) as typeof prisma.$transaction;
const lines = (pine: number, fir: number) => [
  { productId: b.pine.id, qty: pine },
  { productId: b.fir.id, qty: fir },
];
const open = (pine: number, fir: number) =>
  tx((t) => openShift(t, b.seller.id, { pointId: b.point.id, actual: lines(pine, fir) }));
const sell = (input: Partial<SaleInput> = {}) =>
  tx((t) =>
    recordSale(t, b.seller.id, {
      productId: b.pine.id,
      qty: 1,
      stickerPrice: 2000,
      price: 2000,
      payment: "CASH",
      ...input,
    }),
  );
const notifications = () => prisma.notification.findMany({ orderBy: { id: "asc" } });
// Московское время -> момент времени
const msk = (time: string, day = "2026-12-20") => new Date(`${day}T${time}:00+03:00`);

// На точке 20 сосен и 10 пихт; порог низкого остатка 10; смена с 10:00 до 22:00
beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  await receive(b, b.pine.id, 200);
  await receive(b, b.fir.id, 100);
  await transfer(b, b.pine.id, 20, b.loc.warehouse, b.loc.point);
  await transfer(b, b.fir.id, 10, b.loc.warehouse, b.loc.point);
});

describe("уведомления менеджеру", () => {
  it("новая заявка продавца", async () => {
    await tx((t) =>
      createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(5, 0), comment: "срочно" }),
    );
    const list = await notifications();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      userId: b.manager.id,
      type: "NEW_REQUEST",
      title: "Новая заявка на завоз: Рынок",
      link: "/manager/requests",
      readAt: null,
    });
  });

  it("расхождение пересчёта и расхождение по деньгам", async () => {
    await open(20, 10);
    await sell();
    await tx((t) => eveningCount(t, b.seller.id, lines(18, 10)));
    await tx((t) => closeShift(t, b.seller.id, 1500));

    const list = await notifications();
    expect(list.map((n) => n.type)).toEqual(["DAY_SHORTAGE", "CASH_MISMATCH"]);
    expect(list[0].title).toBe("Недостача за смену (-1 шт.)");
    expect(list[1].title).toContain("-500");
  });

  it("запрос отмены продажи", async () => {
    await open(20, 10);
    const sale = await sell();
    await tx((t) => requestSaleCancel(t, b.seller.id, sale.id, "ошибся"));
    expect((await notifications()).map((n) => n.type)).toEqual(["SALE_CANCEL_REQUEST"]);
  });

  it("если действие не сохранилось, уведомления тоже нет", async () => {
    await expect(
      tx((t) => createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(0, 0) })),
    ).rejects.toThrow();
    expect(await notifications()).toEqual([]);
  });

  it("отключённому менеджеру не приходят", async () => {
    await prisma.user.update({ where: { id: b.manager.id }, data: { isActive: false } });
    await tx((t) => createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(5, 0) }));
    expect(await notifications()).toEqual([]);
  });
});

describe("низкий остаток", () => {
  it("сигнал приходит один раз, когда остаток опустился до порога", async () => {
    await open(20, 10); // всего 30, порог 10
    await sell({ qty: 19 }); // осталось 11: ещё выше порога
    expect(await notifications()).toEqual([]);

    await sell({ qty: 1 }); // осталось 10: порог достигнут
    let list = await notifications();
    expect(list.map((n) => n.type)).toEqual(["LOW_STOCK"]);
    expect(list[0].body).toContain("осталось 10");

    await sell({ productId: b.fir.id, stickerPrice: 3000, price: 3000 }); // 9: повторно не шлём
    list = await notifications();
    expect(list).toHaveLength(1);
  });

  it("отменённая продажа не считается: после возврата и новой продажи сигнал придёт снова", async () => {
    await open(20, 10);
    const sale = await sell({ qty: 20 });
    expect(await prisma.notification.count({ where: { type: "LOW_STOCK" } })).toBe(1);
    await tx((t) => requestSaleCancel(t, b.seller.id, sale.id, "ошибка"));
    await tx((t) => decideSaleCancel(t, b.manager.id, { saleId: sale.id, approve: true }));
    await sell({ qty: 20 });
    expect(await prisma.notification.count({ where: { type: "LOW_STOCK" } })).toBe(2);
  });
});

describe("сроки смен", () => {
  // Проверки идут «в заданное время сегодняшних суток» по Москве
  const dayString = (offsetDays: number) =>
    new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const check = (time: string, offsetDays = 0) =>
    tx((t) => checkShiftDeadlines(t, msk(time, dayString(offsetDays))));
  const byType = (type: "SHIFT_NOT_OPENED" | "SHIFT_NOT_CLOSED") =>
    prisma.incident.findMany({ where: { type } });

  it("до срока открытия сигнала нет", async () => {
    expect(await check("09:59")).toBe(0);
    expect(await prisma.incident.count()).toBe(0);
  });

  it("смена не открыта к сроку: один инцидент в сутки и уведомление", async () => {
    expect(await check("10:00")).toBe(1);
    expect(await check("10:05")).toBe(0);
    expect(await check("15:00")).toBe(0);

    const list = await byType("SHIFT_NOT_OPENED");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ pointId: b.point.id, status: "OPEN" });
    expect((await notifications()).map((n) => n.type)).toEqual(["SHIFT_NOT_OPENED"]);
  });

  it("на следующий день сигнал приходит снова", async () => {
    await check("10:00");
    expect(await check("10:00", 1)).toBe(1);
    expect(await byType("SHIFT_NOT_OPENED")).toHaveLength(2);
  });

  it("открытая смена не даёт сигнала «не открыта», а до срока закрытия и «не закрыта»", async () => {
    await open(20, 10);
    expect(await check("12:00")).toBe(0);
    expect(await check("21:59")).toBe(0);
    expect(await prisma.incident.count()).toBe(0);
  });

  it("смена не закрыта к сроку: один инцидент на смену, на продавца", async () => {
    const { shift } = await open(20, 10);
    expect(await check("22:00")).toBe(1);
    expect(await check("23:30")).toBe(0);
    // на следующий день та же смена повторно не фиксируется
    expect(await check("09:00", 1)).toBe(0);

    const list = await byType("SHIFT_NOT_CLOSED");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ shiftId: shift.id, userId: b.seller.id, pointId: b.point.id });
  });

  it("забытая со вчера смена считается просроченной сразу", async () => {
    await open(20, 10);
    expect(await check("00:05", 1)).toBe(1);
    expect((await byType("SHIFT_NOT_CLOSED"))).toHaveLength(1);
  });

  it("закрытая вовремя смена сигналов не даёт", async () => {
    await open(20, 10);
    await tx((t) => eveningCount(t, b.seller.id, lines(20, 10)));
    await tx((t) => closeShift(t, b.seller.id, 0));
    expect(await check("23:00")).toBe(0);
  });

  it("точка без продавцов не проверяется", async () => {
    await tx((t) =>
      updateUser(t, b.manager.id, b.seller.id, {
        fullName: "Продавец",
        isActive: true,
        pointIds: [],
      }),
    );
    expect(await check("12:00")).toBe(0);
  });
});

describe("отчёт по продажам", () => {
  it("считает количество, выручку и процент по точкам, продавцам, дням и видам", async () => {
    await open(20, 10);
    await sell({ qty: 2 }); // сосна 2 × 2000, 10%
    await sell({ price: 1500, discountReason: "торг" }); // сосна 1500
    await sell({ productId: b.fir.id, stickerPrice: 3000, price: 3000, payment: "CARD" }); // 5%
    const cancelled = await sell();
    await tx((t) => requestSaleCancel(t, b.seller.id, cancelled.id, "ошибка"));
    await tx((t) => decideSaleCancel(t, b.manager.id, { saleId: cancelled.id, approve: true }));

    const report = await salesReport(prisma, {});

    expect(report.total).toEqual({ qty: 4, revenue: 8500, commission: 400 + 150 + 150 });
    expect(report.byPoint).toEqual([
      { key: String(b.point.id), label: "Рынок", qty: 4, revenue: 8500, commission: 700 },
    ]);
    expect(report.bySeller[0]).toMatchObject({ label: "Продавец", qty: 4, commission: 700 });
    expect(report.byDay).toHaveLength(1);
    expect(report.byProduct.map((r) => [r.label, r.qty, r.revenue])).toEqual([
      ["Сосна", 3, 5500],
      ["Пихта", 1, 3000],
    ]);
  });

  it("учитывает границы периода", async () => {
    await open(20, 10);
    await sell();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect((await salesReport(prisma, { from: tomorrow })).total.qty).toBe(0);
    expect((await salesReport(prisma, { to: tomorrow })).total.qty).toBe(1);
  });
});
