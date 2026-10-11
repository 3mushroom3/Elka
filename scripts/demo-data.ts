// Учебные данные для показа и обучения: точки, сотрудники, завозы, смены, продажи,
// расхождения. Работает только на пустой базе, чтобы не испортить настоящий учёт.
// Запуск: npx tsx scripts/demo-data.ts (с DATABASE_URL проверочной базы)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createPoint, createUser, updateProduct } from "../src/domain/catalog";
import {
  acceptDelivery,
  confirmLoad,
  confirmUnload,
  createDelivery,
  createRequest,
  depart,
} from "../src/domain/delivery";
import { recordSale, requestSaleCancel } from "../src/domain/sales";
import { closeShift, eveningCount, openShift, productsToCount } from "../src/domain/shift";
import { createReceipt } from "../src/domain/warehouse";
import { createWriteoff } from "../src/domain/writeoff";

const prisma = new PrismaClient();
const tx = prisma.$transaction.bind(prisma) as typeof prisma.$transaction;

// Картинка 1×1 для учебного фото списания
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  if ((await prisma.movement.count()) > 0 || (await prisma.point.count()) > 0) {
    throw new Error("В базе уже есть данные. Учебные данные добавляются только в пустую базу.");
  }
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "MANAGER" } });
  const products = await prisma.product.findMany({ orderBy: { sortOrder: "asc" } });
  const id = (name: string) => products.find((p) => p.name === name)!.id;
  const [spruce, pine, fir] = [id("Ель"), id("Сосна"), id("Пихта")];

  await tx(async (t) => {
    for (const [name, prices] of [
      ["Ель", [1500, 2000, 2500]],
      ["Сосна", [1200, 1800]],
      ["Пихта", [3000, 4000]],
    ] as const) {
      const p = products.find((x) => x.name === name)!;
      await updateProduct(t, admin.id, p.id, {
        name: p.name,
        category: p.category,
        commissionPercent: p.commissionPercent,
        quickPrices: [...prices],
        isCountable: p.isCountable,
        sortOrder: p.sortOrder,
        isActive: p.isActive,
      });
    }
  });

  const point = (name: string, address: string) =>
    tx((t) =>
      createPoint(t, admin.id, {
        name,
        address,
        openDeadline: "00:01",
        closeDeadline: "23:59",
        lowStockThreshold: 10,
        isActive: true,
      }),
    );
  const market = await point("Рынок Центральный", "ул. Ленина, 1");
  const mall = await point("ТЦ Радуга", "пр. Мира, 45");
  const station = await point("У вокзала", "Привокзальная пл.");

  const user = (login: string, fullName: string, role: "SELLER" | "DRIVER", pointIds: number[]) =>
    tx((t) => createUser(t, admin.id, { login, fullName, role, password: `${login}12345`, pointIds }));
  const ivan = await user("ivan", "Иван Петров", "SELLER", [market.id]);
  const olga = await user("olga", "Ольга Смирнова", "SELLER", [mall.id]);
  await user("anna", "Анна Козлова", "SELLER", [station.id]);
  const petr = await user("petr", "Пётр Сидоров", "DRIVER", []);
  const oleg = await user("oleg", "Олег Васильев", "DRIVER", []);

  await tx((t) =>
    createReceipt(t, {
      authorId: admin.id,
      supplier: "Лесхоз «Северный»",
      items: [
        { productId: spruce, qty: 300 },
        { productId: pine, qty: 200 },
        { productId: fir, qty: 80 },
        { productId: id("Веник"), qty: 40 },
      ],
    }),
  );

  // Пересчёт: нули по всем видам, кроме указанных
  const count = async (pointId: number, actual: Record<number, number>) => {
    const loc = await prisma.location.findUniqueOrThrow({ where: { pointId } });
    return (await productsToCount(prisma, loc.id)).map((p) => ({
      productId: p.id,
      qty: actual[p.id] ?? 0,
    }));
  };
  const deliver = async (
    pointId: number,
    driverId: number,
    sellerId: number | null,
    items: { productId: number; qty: number }[],
    received?: { productId: number; qty: number }[],
    stopAt?: "ASSIGNED" | "IN_TRANSIT" | "DELIVERED",
  ) => {
    const trip = await tx((t) => createDelivery(t, admin.id, { pointId, driverId, items }));
    if (stopAt === "ASSIGNED") return;
    await tx((t) => confirmLoad(t, driverId, trip.id, items));
    await tx((t) => depart(t, driverId, trip.id));
    if (stopAt === "IN_TRANSIT") return;
    await tx((t) => confirmUnload(t, driverId, trip.id, items));
    if (stopAt === "DELIVERED" || sellerId === null) return;
    await tx((t) => acceptDelivery(t, sellerId, trip.id, received ?? items));
  };
  const sell = (
    sellerId: number,
    productId: number,
    price: number,
    payment: "CASH" | "TRANSFER" | "CARD",
    extra: { qty?: number; sticker?: number; reason?: string } = {},
  ) =>
    tx((t) =>
      recordSale(t, sellerId, {
        productId,
        qty: extra.qty ?? 1,
        stickerPrice: extra.sticker ?? price,
        price,
        discountReason: extra.reason,
        payment,
      }),
    );

  // ТЦ Радуга: полный день, закрыт с недостачей одной ели и 500 ₽
  await tx(async (t) => openShift(t, olga.id, { pointId: mall.id, actual: await count(mall.id, {}) }));
  await deliver(mall.id, oleg.id, olga.id, [
    { productId: spruce, qty: 30 },
    { productId: fir, qty: 10 },
  ]);
  for (const price of [2000, 2000, 2500, 1500, 2000]) await sell(olga.id, spruce, price, "CASH");
  await sell(olga.id, fir, 4000, "CARD");
  await sell(olga.id, fir, 3500, "TRANSFER", { sticker: 4000, reason: "Торг" });
  await tx(async (t) =>
    eveningCount(t, olga.id, await count(mall.id, { [spruce]: 24, [fir]: 8 })),
  );
  await tx((t) => closeShift(t, olga.id, 9500));

  // Рынок: смена открыта, идут продажи, приём с расхождением, есть запросы менеджеру
  await tx(async (t) =>
    openShift(t, ivan.id, { pointId: market.id, actual: await count(market.id, {}) }),
  );
  await deliver(
    market.id,
    petr.id,
    ivan.id,
    [
      { productId: spruce, qty: 25 },
      { productId: pine, qty: 15 },
    ],
    [
      { productId: spruce, qty: 25 },
      { productId: pine, qty: 13 },
    ],
  );
  await sell(ivan.id, spruce, 2000, "CASH");
  await sell(ivan.id, spruce, 2500, "CARD");
  await sell(ivan.id, pine, 1800, "CASH", { qty: 2 });
  const mistake = await sell(ivan.id, pine, 1200, "TRANSFER");
  await tx((t) => requestSaleCancel(t, ivan.id, mistake.id, "пробил лишнюю сосну"));
  await sell(ivan.id, spruce, 2000, "CASH", { qty: 18 });
  await sell(ivan.id, pine, 1800, "CARD", { qty: 5 });

  const uploads = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
  mkdirSync(uploads, { recursive: true });
  writeFileSync(path.join(uploads, "demo-writeoff.png"), PNG);
  const photo = await prisma.attachment.create({
    data: { fileName: "demo-writeoff.png", mime: "image/png", size: PNG.length, uploadedById: ivan.id },
  });
  await tx((t) =>
    createWriteoff(t, ivan.id, {
      productId: spruce,
      qty: 1,
      reason: "BROKEN",
      comment: "сломали верхушку при разгрузке",
      photoId: photo.id,
    }),
  );
  await tx((t) =>
    createRequest(t, ivan.id, {
      pointId: market.id,
      items: [
        { productId: spruce, qty: 30 },
        { productId: fir, qty: 10 },
      ],
      comment: "ели заканчиваются",
    }),
  );

  // У вокзала: смена не открыта, рейс в пути и ещё один назначен
  await deliver(station.id, oleg.id, null, [{ productId: spruce, qty: 20 }], undefined, "IN_TRANSIT");
  await deliver(station.id, petr.id, null, [{ productId: pine, qty: 20 }], undefined, "ASSIGNED");

  console.log("Учебные данные созданы. Пароли сотрудников: <логин>12345 (ivan, olga, anna, petr, oleg).");
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
