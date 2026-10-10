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
import { allowedActions, type IncidentAction, resolveIncident } from "@/domain/incidents";
import { findNegativeBalances } from "@/domain/ledger";
import { recordSale } from "@/domain/sales";
import { closeShift, eveningCount, openShift } from "@/domain/shift";
import { summarizeShortages } from "@/domain/shortage";
import { createWriteoff, decideWriteoff } from "@/domain/writeoff";
import { balance, type Basics, receive, resetDb, seedBasics, transfer } from "./helpers";

let b: Basics;
let writtenOff: number;

const tx = prisma.$transaction.bind(prisma) as typeof prisma.$transaction;
const lines = (pine: number, fir: number) => [
  { productId: b.pine.id, qty: pine },
  { productId: b.fir.id, qty: fir },
];
const open = (pine: number, fir: number, sellerId = b.seller.id) =>
  tx((t) => openShift(t, sellerId, { pointId: b.point.id, actual: lines(pine, fir) }));
const evening = (pine: number, fir: number, sellerId = b.seller.id) =>
  tx((t) => eveningCount(t, sellerId, lines(pine, fir)));
const incidents = () => prisma.incident.findMany({ orderBy: { id: "asc" } });
const resolve = (incidentId: number, action: IncidentAction, chargedUserId?: number) =>
  tx((t) =>
    resolveIncident(t, b.manager.id, { incidentId, action, resolution: "разобрано", chargedUserId }),
  );

async function photo(userId = b.seller.id) {
  const count = await prisma.attachment.count();
  return prisma.attachment.create({
    data: { fileName: `test-${count}.jpg`, mime: "image/jpeg", size: 1, uploadedById: userId },
  });
}

async function writeoff(qty = 1, sellerId = b.seller.id) {
  const p = await photo(sellerId);
  return tx((t) =>
    createWriteoff(t, sellerId, {
      productId: b.pine.id,
      qty,
      reason: "BROKEN",
      comment: "сломали при разгрузке",
      photoId: p.id,
    }),
  );
}

// На точке 20 сосен и 10 пихт
beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  await receive(b, b.pine.id, 200);
  await receive(b, b.fir.id, 100);
  await transfer(b, b.pine.id, 20, b.loc.warehouse, b.loc.point);
  await transfer(b, b.fir.id, 10, b.loc.warehouse, b.loc.point);
  writtenOff = (
    await prisma.location.findFirstOrThrow({ where: { type: "WRITTEN_OFF" } })
  ).id;
});

describe("списание", () => {
  it("доступно только в открытой смене", async () => {
    await expect(writeoff()).rejects.toThrow("открытой смене");
  });

  it("без фото не принимается, чужое фото тоже", async () => {
    await open(20, 10);
    const create = (photoId: number) =>
      tx((t) =>
        createWriteoff(t, b.seller.id, {
          productId: b.pine.id,
          qty: 1,
          reason: "DEFECT",
          photoId,
        }),
      );
    await expect(create(999)).rejects.toThrow("фото");
    const foreign = await photo(b.driver.id);
    await expect(create(foreign.id)).rejects.toThrow("фото");
  });

  it("запрос не меняет остатки до решения менеджера", async () => {
    await open(20, 10);
    const w = await writeoff(2);

    expect(w.status).toBe("PENDING");
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
    expect(await balance(writtenOff, b.pine.id)).toBe(0);
  });

  it("одобрение переносит товар в «Списано» от имени менеджера", async () => {
    await open(20, 10);
    const w = await writeoff(2);
    await tx((t) => decideWriteoff(t, b.manager.id, { writeoffId: w.id, approve: true }));

    expect(await balance(b.loc.point, b.pine.id)).toBe(18);
    expect(await balance(writtenOff, b.pine.id)).toBe(2);
    const movement = await prisma.movement.findFirstOrThrow({ where: { writeoffId: w.id } });
    expect(movement).toMatchObject({ type: "WRITEOFF", qty: 2, authorId: b.manager.id });
    expect((await prisma.writeoffRequest.findUniqueOrThrow({ where: { id: w.id } })).status).toBe(
      "APPROVED",
    );
  });

  it("одобренное списание учитывается в вечернем остатке", async () => {
    await open(20, 10);
    await tx((t) =>
      recordSale(t, b.seller.id, {
        productId: b.pine.id,
        qty: 3,
        stickerPrice: 2000,
        price: 2000,
        payment: "CASH",
      }),
    );
    const w = await writeoff(2);
    await tx((t) => decideWriteoff(t, b.manager.id, { writeoffId: w.id, approve: true }));

    // 20 - 3 продано - 2 списано = 15
    expect((await evening(15, 10)).diffs).toEqual([]);
    expect(await incidents()).toEqual([]);
  });

  it("отказ требует причину и оставляет товар на точке", async () => {
    await open(20, 10);
    const w = await writeoff(1);
    await expect(
      tx((t) => decideWriteoff(t, b.manager.id, { writeoffId: w.id, approve: false })),
    ).rejects.toThrow("причину");
    await tx((t) =>
      decideWriteoff(t, b.manager.id, {
        writeoffId: w.id,
        approve: false,
        comment: "на фото ёлка целая",
      }),
    );

    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
    // Не досчитался вечером: это уже недостача продавца
    const { diffs } = await evening(19, 10);
    expect(diffs.map((d) => d.diff)).toEqual([-1]);
  });

  it("решение принимается один раз", async () => {
    await open(20, 10);
    const w = await writeoff(1);
    const results = await Promise.allSettled([
      tx((t) => decideWriteoff(t, b.manager.id, { writeoffId: w.id, approve: true })),
      tx((t) => decideWriteoff(t, b.manager.id, { writeoffId: w.id, approve: true })),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(b.loc.point, b.pine.id)).toBe(19);
  });

  it("пока запрос не рассмотрен, смену закрыть нельзя", async () => {
    await open(20, 10);
    const w = await writeoff(1);
    await expect(evening(19, 10)).rejects.toThrow("списания");

    await tx((t) => decideWriteoff(t, b.manager.id, { writeoffId: w.id, approve: true }));
    expect((await evening(19, 10)).diffs).toEqual([]);
  });

  it("нельзя запросить списание больше, чем числится, в том числе несколькими запросами", async () => {
    await open(20, 10);
    await expect(writeoff(21)).rejects.toThrow(DomainError);
    await writeoff(15);
    await expect(writeoff(6)).rejects.toThrow(DomainError);
    await writeoff(5);
  });

  it("нулевое количество и причина «другое» без описания отклоняются", async () => {
    await open(20, 10);
    await expect(writeoff(0)).rejects.toThrow(DomainError);
    const p = await photo();
    await expect(
      tx((t) =>
        createWriteoff(t, b.seller.id, {
          productId: b.pine.id,
          qty: 1,
          reason: "OTHER",
          photoId: p.id,
        }),
      ),
    ).rejects.toThrow(DomainError);
  });
});

describe("разбор недостачи на точке", () => {
  // Вечером не хватает двух сосен
  async function shortage() {
    await open(20, 10);
    await evening(18, 10);
    await tx((t) => closeShift(t, b.seller.id, 0));
    return (await incidents())[0];
  }

  it("записать на продавца: товар остаётся в недостаче", async () => {
    const incident = await shortage();
    expect(allowedActions(incident)).toEqual(["CHARGE", "RETURN_TO_POINT", "WRITE_OFF"]);
    await resolve(incident.id, "CHARGE");

    const saved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(saved).toMatchObject({
      status: "RESOLVED",
      outcome: "CHARGED",
      chargedUserId: b.seller.id,
      resolvedById: b.manager.id,
    });
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(2);
    expect(await balance(b.loc.point, b.pine.id)).toBe(18);
    expect(await prisma.movement.count({ where: { incidentId: incident.id } })).toBe(0);
  });

  it("товар нашёлся: возвращается на точку проводкой, на продавца не записывается", async () => {
    const incident = await shortage();
    await resolve(incident.id, "RETURN_TO_POINT");

    expect(await balance(b.loc.shortage, b.pine.id)).toBe(0);
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
    const movement = await prisma.movement.findFirstOrThrow({
      where: { incidentId: incident.id },
    });
    expect(movement).toMatchObject({ type: "CORRECTION", qty: 2, authorId: b.manager.id });
    expect(movement.reason).toContain(`Инцидент №${incident.id}`);
    const saved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(saved.outcome).toBe("NOT_CHARGED");
    expect(saved.chargedUserId).toBeNull();
  });

  it("списать: из недостачи в «Списано»", async () => {
    const incident = await shortage();
    await resolve(incident.id, "WRITE_OFF");

    expect(await balance(b.loc.shortage, b.pine.id)).toBe(0);
    expect(await balance(writtenOff, b.pine.id)).toBe(2);
    expect(await balance(b.loc.point, b.pine.id)).toBe(18);
  });

  it("излишек: ошибка пересчёта убирает его обратно", async () => {
    await open(20, 10);
    await evening(20, 12);
    const [incident] = await incidents();
    expect(allowedActions(incident)).toEqual(["DISMISS", "RETURN_TO_POINT"]);
    await resolve(incident.id, "RETURN_TO_POINT");

    expect(await balance(b.loc.point, b.fir.id)).toBe(10);
    expect(await balance(b.loc.shortage, b.fir.id)).toBe(0);
  });

  it("решение обязательно, действие должно подходить, закрыть можно один раз", async () => {
    const incident = await shortage();
    await expect(
      tx((t) =>
        resolveIncident(t, b.manager.id, {
          incidentId: incident.id,
          action: "CHARGE",
          resolution: " ",
        }),
      ),
    ).rejects.toThrow(DomainError);
    await expect(resolve(incident.id, "RETURN_TO_WAREHOUSE")).rejects.toThrow(DomainError);
    await expect(resolve(incident.id, "DISMISS")).rejects.toThrow(DomainError);

    await resolve(incident.id, "CHARGE");
    await expect(resolve(incident.id, "RETURN_TO_POINT")).rejects.toThrow("уже закрыт");
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(2);
  });

  it("ночную недостачу менеджер записывает на одного из двух продавцов", async () => {
    const other = await tx((t) =>
      createUser(t, b.manager.id, {
        login: "seller2",
        fullName: "Сменщик",
        role: Role.SELLER,
        password: "secret123",
        pointIds: [b.point.id],
      }),
    );
    await open(20, 10);
    await evening(20, 10);
    await tx((t) => closeShift(t, b.seller.id, 0));
    await open(19, 10, other.id);
    const [incident] = await incidents();
    expect(incident.type).toBe("NIGHT_SHORTAGE");

    await expect(resolve(incident.id, "CHARGE", b.driver.id)).rejects.toThrow(DomainError);
    await resolve(incident.id, "CHARGE", other.id);
    expect(
      (await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).chargedUserId,
    ).toBe(other.id);
  });
});

describe("разбор расхождения при приёме", () => {
  // Водитель выгрузил 10 сосен, продавец принял 8: две числятся на водителе
  async function mismatch() {
    await open(20, 10);
    const trip = await tx((t) =>
      createDelivery(t, b.manager.id, {
        pointId: b.point.id,
        driverId: b.driver.id,
        items: lines(10, 0),
      }),
    );
    const ten = [{ productId: b.pine.id, qty: 10 }];
    await tx((t) => confirmLoad(t, b.driver.id, trip.id, ten));
    await tx((t) => depart(t, b.driver.id, trip.id));
    await tx((t) => confirmUnload(t, b.driver.id, trip.id, ten));
    await tx((t) =>
      acceptDelivery(t, b.seller.id, trip.id, [{ productId: b.pine.id, qty: 8 }]),
    );
    const [incident] = await incidents();
    expect(await balance(b.loc.driver, b.pine.id)).toBe(2);
    return incident;
  }

  it("записать на водителя: товар уходит с водителя в недостачу", async () => {
    const incident = await mismatch();
    expect(allowedActions(incident)).toEqual(["CHARGE", "RETURN_TO_WAREHOUSE", "RETURN_TO_POINT"]);
    await resolve(incident.id, "CHARGE");

    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(2);
    expect(
      (await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).chargedUserId,
    ).toBe(b.driver.id);
  });

  it("водитель вернул на склад", async () => {
    const incident = await mismatch();
    await resolve(incident.id, "RETURN_TO_WAREHOUSE");

    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(172);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(0);
  });

  it("товар на точке: продавец ошибся при приёме", async () => {
    const incident = await mismatch();
    await resolve(incident.id, "RETURN_TO_POINT");

    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
    expect(await balance(b.loc.point, b.pine.id)).toBe(30);
  });

  it("если товар с водителя уже сняли, повторная проводка не проходит и инцидент остаётся открытым", async () => {
    const incident = await mismatch();
    await transfer(b, b.pine.id, 2, b.loc.driver, b.loc.warehouse);

    await expect(resolve(incident.id, "CHARGE")).rejects.toThrow(DomainError);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      "OPEN",
    );
    expect(await findNegativeBalances(prisma)).toEqual([]);
  });
});

describe("накопленная недостача по сотрудникам", () => {
  it("разделяет «на разборе», «записано» и снятое", async () => {
    // Смена 1: не хватает 2 сосен и 500 ₽ - записываем на продавца
    await open(20, 10);
    await tx((t) =>
      recordSale(t, b.seller.id, {
        productId: b.pine.id,
        qty: 1,
        stickerPrice: 2000,
        price: 1500,
        discountReason: "торг",
        payment: "CASH",
      }),
    );
    await evening(17, 10);
    await tx((t) => closeShift(t, b.seller.id, 1000));
    for (const i of await incidents()) {
      if (i.type !== "DISCOUNT") await resolve(i.id, "CHARGE");
    }
    // Смена 2: не хватает 1 пихты (на разборе) и 3 сосен (нашлись)
    await open(17, 10);
    await evening(14, 9);
    const pine = (await incidents()).find(
      (i) => i.status === "OPEN" && i.type === "DAY_SHORTAGE" && i.productId === b.pine.id,
    )!;
    await resolve(pine.id, "RETURN_TO_POINT");

    const rows = summarizeShortages(await incidents());
    expect(rows).toEqual([
      {
        userId: b.seller.id,
        stemsOpen: 1,
        stemsCharged: 2,
        cashOpen: 0,
        cashCharged: 500,
        discounts: 500,
        dismissed: 1,
      },
    ]);
  });

  it("излишки и лишние деньги недостачу не уменьшают", () => {
    const base = {
      status: "OPEN" as const,
      outcome: null,
      userId: 1,
      secondUserId: null,
      chargedUserId: null,
    };
    const rows = summarizeShortages([
      { ...base, type: "DAY_SHORTAGE", qty: -3, amount: 0 },
      { ...base, type: "DAY_SURPLUS", qty: 2, amount: 0 },
      { ...base, type: "CASH_MISMATCH", qty: 0, amount: 700 },
    ]);
    expect(rows).toEqual([
      {
        userId: 1,
        stemsOpen: 3,
        stemsCharged: 0,
        cashOpen: 0,
        cashCharged: 0,
        discounts: 0,
        dismissed: 0,
      },
    ]);
  });
});
