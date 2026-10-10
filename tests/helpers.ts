import { LocationType, MovementType, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPoint, createProduct, createUser } from "@/domain/catalog";
import { getBalance, postMovement, systemLocationId } from "@/domain/ledger";
import { createReceipt } from "@/domain/warehouse";

// Очистка тестовой базы. Триггеры защиты журнала отключаются на одну транзакцию:
// это возможно только суперпользователю БД и используется только в тестах.
export async function resetDb() {
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
    prisma.$executeRawUnsafe(
      `TRUNCATE movements, audit_log, notifications, incidents, writeoff_requests, attachments, sale_items, sales, stock_count_items,
       stock_counts, shifts, trip_items, trips, request_items,
       delivery_requests, purchase_items, purchase_receipts, user_points,
       sessions, locations, products, points, users RESTART IDENTITY CASCADE`,
    ),
    prisma.$executeRawUnsafe(
      `INSERT INTO locations (type) VALUES
       ('SUPPLIER'), ('WAREHOUSE'), ('SOLD'), ('WRITTEN_OFF'), ('SHORTAGE')`,
    ),
  ]);
}

// Базовый набор: менеджер, продавец, водитель, точка, два вида товара.
export async function seedBasics() {
  return prisma.$transaction(async (tx) => {
    const manager = await createUser(tx, null, {
      login: "manager",
      fullName: "Менеджер",
      role: Role.MANAGER,
      password: "secret123",
      pointIds: [],
    });
    const point = await createPoint(tx, manager.id, {
      name: "Рынок",
      address: "",
      openDeadline: "10:00",
      closeDeadline: "22:00",
      lowStockThreshold: 10,
      isActive: true,
    });
    const seller = await createUser(tx, manager.id, {
      login: "seller",
      fullName: "Продавец",
      role: Role.SELLER,
      password: "secret123",
      pointIds: [point.id],
    });
    const driver = await createUser(tx, manager.id, {
      login: "driver",
      fullName: "Водитель",
      role: Role.DRIVER,
      password: "secret123",
      pointIds: [],
    });
    const product = (name: string, commissionPercent: number) =>
      createProduct(tx, manager.id, {
        name,
        category: "TREE",
        commissionPercent,
        quickPrices: [],
        isCountable: true,
        sortOrder: 0,
        isActive: true,
      });
    const pine = await product("Сосна", 10);
    const fir = await product("Пихта", 5);

    return {
      manager,
      seller,
      driver,
      point,
      pine,
      fir,
      loc: {
        supplier: await systemLocationId(tx, LocationType.SUPPLIER),
        warehouse: await systemLocationId(tx, LocationType.WAREHOUSE),
        sold: await systemLocationId(tx, LocationType.SOLD),
        shortage: await systemLocationId(tx, LocationType.SHORTAGE),
        driver: (await tx.location.findUniqueOrThrow({ where: { driverId: driver.id } })).id,
        point: (await tx.location.findUniqueOrThrow({ where: { pointId: point.id } })).id,
      },
    };
  });
}

export type Basics = Awaited<ReturnType<typeof seedBasics>>;

export function receive(b: Basics, productId: number, qty: number) {
  return prisma.$transaction((tx) =>
    createReceipt(tx, { authorId: b.manager.id, items: [{ productId, qty }] }),
  );
}

export function transfer(
  b: Basics,
  productId: number,
  qty: number,
  fromLocationId: number,
  toLocationId: number,
  extra: { type?: MovementType } = {},
) {
  return prisma.$transaction((tx) =>
    postMovement(tx, {
      type: extra.type ?? MovementType.TRANSFER,
      productId,
      qty,
      fromLocationId,
      toLocationId,
      authorId: b.manager.id,
    }),
  );
}

export function balance(locationId: number, productId: number) {
  return getBalance(prisma, locationId, productId);
}
