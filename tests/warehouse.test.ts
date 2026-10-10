import { MovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { updatePoint, updateUser } from "@/domain/catalog";
import { DomainError } from "@/domain/errors";
import { verifyPassword } from "@/domain/password";
import { createReceipt, warehouseInventory } from "@/domain/warehouse";
import { balance, type Basics, receive, resetDb, seedBasics, transfer } from "./helpers";

let b: Basics;

beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
});

describe("приход на склад", () => {
  it("создаёт документ и по движению на каждый вид", async () => {
    const receipt = await prisma.$transaction((tx) =>
      createReceipt(tx, {
        authorId: b.manager.id,
        supplier: "Лесхоз",
        items: [
          { productId: b.pine.id, qty: 200 },
          { productId: b.fir.id, qty: 0 },
        ],
      }),
    );

    const movements = await prisma.movement.findMany({ where: { receiptId: receipt.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: MovementType.RECEIPT,
      productId: b.pine.id,
      qty: 200,
      fromLocationId: b.loc.supplier,
      toLocationId: b.loc.warehouse,
      authorId: b.manager.id,
    });
    expect(await prisma.purchaseItem.count({ where: { receiptId: receipt.id } })).toBe(1);
  });

  it("пустой приход отклоняется", async () => {
    await expect(
      prisma.$transaction((tx) => createReceipt(tx, { authorId: b.manager.id, items: [] })),
    ).rejects.toThrow(DomainError);
  });

  it("при ошибке в одной строке не сохраняется ничего", async () => {
    await expect(
      prisma.$transaction((tx) =>
        createReceipt(tx, {
          authorId: b.manager.id,
          items: [
            { productId: b.pine.id, qty: 10 },
            { productId: b.fir.id, qty: -1 },
          ],
        }),
      ),
    ).rejects.toThrow(DomainError);

    expect(await prisma.purchaseReceipt.count()).toBe(0);
    expect(await prisma.movement.count()).toBe(0);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(0);
  });
});

describe("инвентаризация склада", () => {
  const inventory = (pine: number, fir: number, reason = "плановая") =>
    prisma.$transaction((tx) =>
      warehouseInventory(tx, {
        authorId: b.manager.id,
        reason,
        actual: [
          { productId: b.pine.id, qty: pine },
          { productId: b.fir.id, qty: fir },
        ],
      }),
    );

  beforeEach(async () => {
    await receive(b, b.pine.id, 100);
    await receive(b, b.fir.id, 40);
  });

  it("без расхождений не создаёт движений", async () => {
    const before = await prisma.movement.count();
    expect(await inventory(100, 40, "")).toEqual([]);
    expect(await prisma.movement.count()).toBe(before);
  });

  it("считает недостачу и излишек по каждому виду", async () => {
    const diffs = await inventory(97, 41);

    expect(diffs).toEqual([
      { productId: b.pine.id, expected: 100, actual: 97, delta: -3 },
      { productId: b.fir.id, expected: 40, actual: 41, delta: 1 },
    ]);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(97);
    expect(await balance(b.loc.warehouse, b.fir.id)).toBe(41);
    expect(await balance(b.loc.shortage, b.pine.id)).toBe(3);
    expect(await balance(b.loc.shortage, b.fir.id)).toBe(-1);
  });

  it("учитывает уже выданное водителю", async () => {
    await transfer(b, b.pine.id, 30, b.loc.warehouse, b.loc.driver);
    const diffs = await inventory(69, 40);

    expect(diffs).toEqual([{ productId: b.pine.id, expected: 70, actual: 69, delta: -1 }]);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(30);
  });

  it("расхождение без причины отклоняется", async () => {
    await expect(inventory(99, 40, "")).rejects.toThrow(DomainError);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(100);
  });

  it("отрицательный факт отклоняется", async () => {
    await expect(inventory(-1, 40)).rejects.toThrow(DomainError);
  });
});

describe("справочники и места учёта", () => {
  it("у водителя и у точки есть своё место учёта", async () => {
    expect(b.loc.driver).toBeGreaterThan(0);
    expect(b.loc.point).toBeGreaterThan(0);
    expect(b.loc.driver).not.toBe(b.loc.point);
  });

  it("нельзя отключить водителя, за которым числится товар", async () => {
    await receive(b, b.pine.id, 10);
    await transfer(b, b.pine.id, 3, b.loc.warehouse, b.loc.driver);
    const disable = () =>
      prisma.$transaction((tx) =>
        updateUser(tx, b.manager.id, b.driver.id, {
          fullName: "Водитель",
          isActive: false,
          pointIds: [],
        }),
      );

    await expect(disable()).rejects.toThrow(DomainError);
    await transfer(b, b.pine.id, 3, b.loc.driver, b.loc.warehouse);
    await disable();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.driver.id } })).isActive).toBe(
      false,
    );
  });

  it("нельзя закрыть точку с остатком", async () => {
    await receive(b, b.pine.id, 10);
    await transfer(b, b.pine.id, 3, b.loc.warehouse, b.loc.point);
    await expect(
      prisma.$transaction((tx) =>
        updatePoint(tx, b.manager.id, b.point.id, {
          name: "Рынок",
          address: "",
          openDeadline: "10:00",
          closeDeadline: "22:00",
          lowStockThreshold: 10,
          isActive: false,
        }),
      ),
    ).rejects.toThrow(DomainError);
  });

  it("смена пароля закрывает сессии сотрудника", async () => {
    await prisma.session.create({
      data: { tokenHash: "x", userId: b.seller.id, expiresAt: new Date(Date.now() + 1e6) },
    });
    await prisma.$transaction((tx) =>
      updateUser(tx, b.manager.id, b.seller.id, {
        fullName: "Продавец",
        isActive: true,
        pointIds: [b.point.id],
        newPassword: "newsecret",
      }),
    );

    expect(await prisma.session.count({ where: { userId: b.seller.id } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: b.seller.id } });
    expect(await verifyPassword("newsecret", user.passwordHash)).toBe(true);
    expect(await verifyPassword("secret123", user.passwordHash)).toBe(false);
  });

  it("менеджер не может отключить сам себя", async () => {
    await expect(
      prisma.$transaction((tx) =>
        updateUser(tx, b.manager.id, b.manager.id, {
          fullName: "Менеджер",
          isActive: false,
          pointIds: [],
        }),
      ),
    ).rejects.toThrow(DomainError);
  });
});
