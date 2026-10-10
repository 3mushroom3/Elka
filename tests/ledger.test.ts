import { MovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { DomainError } from "@/domain/errors";
import { findNegativeBalances, getAllBalances, postCorrection } from "@/domain/ledger";
import { balance, type Basics, receive, resetDb, seedBasics, transfer } from "./helpers";

let b: Basics;

beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
});

describe("остатки считаются из журнала", () => {
  it("приход увеличивает остаток склада", async () => {
    await receive(b, b.pine.id, 100);
    await receive(b, b.pine.id, 50);
    await receive(b, b.fir.id, 20);

    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(150);
    expect(await balance(b.loc.warehouse, b.fir.id)).toBe(20);
    expect(await balance(b.loc.point, b.pine.id)).toBe(0);
  });

  it("перемещение уменьшает остаток источника и увеличивает остаток получателя", async () => {
    await receive(b, b.pine.id, 100);
    await transfer(b, b.pine.id, 30, b.loc.warehouse, b.loc.driver);
    await transfer(b, b.pine.id, 25, b.loc.driver, b.loc.point);
    await transfer(b, b.pine.id, 4, b.loc.point, b.loc.sold, { type: MovementType.SALE });

    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(70);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(5);
    expect(await balance(b.loc.point, b.pine.id)).toBe(21);
    expect(await balance(b.loc.sold, b.pine.id)).toBe(4);
  });

  it("каждая ёлка числится ровно в одном месте: сумма по местам равна приходу", async () => {
    await receive(b, b.pine.id, 100);
    await transfer(b, b.pine.id, 40, b.loc.warehouse, b.loc.driver);
    await transfer(b, b.pine.id, 35, b.loc.driver, b.loc.point);
    await transfer(b, b.pine.id, 10, b.loc.point, b.loc.sold, { type: MovementType.SALE });
    await prisma.$transaction((tx) =>
      postCorrection(tx, {
        locationId: b.loc.point,
        productId: b.pine.id,
        delta: -2,
        kind: "INVENTORY",
        reason: "не досчитались",
        authorId: b.manager.id,
      }),
    );

    const all = await getAllBalances(prisma);
    let total = 0;
    for (const [locationId, products] of all) {
      if (locationId !== b.loc.supplier) total += products.get(b.pine.id) ?? 0;
    }
    expect(total).toBe(100);
    expect(all.get(b.loc.supplier)?.get(b.pine.id)).toBe(-100);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(2);
  });
});

describe("запреты", () => {
  it("нельзя переместить больше, чем есть", async () => {
    await receive(b, b.pine.id, 10);
    await expect(transfer(b, b.pine.id, 11, b.loc.warehouse, b.loc.driver)).rejects.toThrow(
      DomainError,
    );
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(10);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
  });

  it("остаток одного вида не покрывает другой", async () => {
    await receive(b, b.pine.id, 10);
    await expect(transfer(b, b.fir.id, 1, b.loc.warehouse, b.loc.driver)).rejects.toThrow(
      DomainError,
    );
  });

  it.each([0, -5, 1.5])("количество %s отклоняется", async (qty) => {
    await receive(b, b.pine.id, 10);
    await expect(transfer(b, b.pine.id, qty, b.loc.warehouse, b.loc.driver)).rejects.toThrow(
      DomainError,
    );
  });

  it("нельзя переместить в то же место", async () => {
    await receive(b, b.pine.id, 10);
    await expect(
      transfer(b, b.pine.id, 1, b.loc.warehouse, b.loc.warehouse),
    ).rejects.toThrow(DomainError);
  });

  it("два одновременных списания не уводят остаток в минус", async () => {
    await receive(b, b.pine.id, 10);
    const results = await Promise.allSettled([
      transfer(b, b.pine.id, 6, b.loc.warehouse, b.loc.driver),
      transfer(b, b.pine.id, 6, b.loc.warehouse, b.loc.point),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(4);
    expect(await findNegativeBalances(prisma)).toEqual([]);
  });
});

describe("журнал нельзя изменить", () => {
  it("UPDATE записи журнала отклоняется базой данных", async () => {
    await receive(b, b.pine.id, 10);
    await expect(prisma.$executeRawUnsafe("UPDATE movements SET qty = 1")).rejects.toThrow();
    await expect(
      prisma.movement.updateMany({ data: { qty: 1 } }),
    ).rejects.toThrow();
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(10);
  });

  it("DELETE записи журнала отклоняется базой данных", async () => {
    await receive(b, b.pine.id, 10);
    await expect(prisma.$executeRawUnsafe("DELETE FROM movements")).rejects.toThrow();
    await expect(prisma.movement.deleteMany()).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe("TRUNCATE movements")).rejects.toThrow();
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(10);
  });

  it("журнал действий тоже нельзя изменить или удалить", async () => {
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
    await expect(prisma.auditLog.updateMany({ data: { action: "x" } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow();
  });

  it("база не принимает движение с нулевым или отрицательным количеством в обход приложения", async () => {
    const insert = (qty: number) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO movements (type, product_id, qty, from_location_id, to_location_id, author_id)
         VALUES ('TRANSFER', ${b.pine.id}, ${qty}, ${b.loc.supplier}, ${b.loc.warehouse}, ${b.manager.id})`,
      );
    await expect(insert(0)).rejects.toThrow();
    await expect(insert(-3)).rejects.toThrow();
  });
});

describe("корректировка", () => {
  const correct = (delta: number, kind: "INVENTORY" | "RECEIPT_ERROR", reason = "пересчёт") =>
    prisma.$transaction((tx) =>
      postCorrection(tx, {
        locationId: b.loc.warehouse,
        productId: b.pine.id,
        delta,
        kind,
        reason,
        authorId: b.manager.id,
      }),
    );

  it("без причины не проводится", async () => {
    await receive(b, b.pine.id, 10);
    await expect(correct(-1, "INVENTORY", "   ")).rejects.toThrow(DomainError);
  });

  it("недостача уходит в отдельное место, а не исчезает", async () => {
    await receive(b, b.pine.id, 10);
    const m = await correct(-3, "INVENTORY");

    expect(m.type).toBe(MovementType.CORRECTION);
    expect(m.reason).toBe("пересчёт");
    expect(m.authorId).toBe(b.manager.id);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(7);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(3);
  });

  it("излишек приходит из недостачи", async () => {
    await receive(b, b.pine.id, 10);
    await correct(2, "INVENTORY");

    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(12);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(-2);
  });

  it("ошибка прихода возвращается поставщику", async () => {
    await receive(b, b.pine.id, 100);
    await correct(-90, "RECEIPT_ERROR", "ввели 100 вместо 10");

    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(10);
    expect(await balance(b.loc.supplier, b.pine.id)).toBe(-10);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(0);
  });

  it("нельзя списать корректировкой больше, чем числится", async () => {
    await receive(b, b.pine.id, 5);
    await expect(correct(-6, "INVENTORY")).rejects.toThrow(DomainError);
  });

  it("исходная запись остаётся в журнале без изменений", async () => {
    await receive(b, b.pine.id, 100);
    await correct(-90, "RECEIPT_ERROR");

    const movements = await prisma.movement.findMany({ orderBy: { id: "asc" } });
    expect(movements.map((m) => [m.type, m.qty])).toEqual([
      [MovementType.RECEIPT, 100],
      [MovementType.CORRECTION, 90],
    ]);
  });
});

describe("продажа сверх учётного остатка", () => {
  it("запрещена: продать можно только то, что числится на точке", async () => {
    await receive(b, b.pine.id, 5);
    await transfer(b, b.pine.id, 5, b.loc.warehouse, b.loc.point);

    await expect(
      transfer(b, b.pine.id, 6, b.loc.point, b.loc.sold, { type: MovementType.SALE }),
    ).rejects.toThrow(DomainError);
    expect(await balance(b.loc.point, b.pine.id)).toBe(5);
    expect(await findNegativeBalances(prisma)).toEqual([]);
  });
});
