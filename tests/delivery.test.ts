import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createUser } from "@/domain/catalog";
import {
  acceptDelivery,
  acceptReturn,
  approveRequest,
  cancelTrip,
  confirmLoad,
  confirmUnload,
  createDelivery,
  createRequest,
  depart,
  rejectRequest,
} from "@/domain/delivery";
import { DomainError } from "@/domain/errors";
import { resolveIncident } from "@/domain/incidents";
import { findNegativeBalances } from "@/domain/ledger";
import { openShift } from "@/domain/shift";
import { balance, type Basics, receive, resetDb, seedBasics } from "./helpers";

let b: Basics;

beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  await receive(b, b.pine.id, 100);
  await receive(b, b.fir.id, 50);
  // Приём доставки возможен только в открытой смене; точка пока пустая
  await prisma.$transaction((t) =>
    openShift(t, b.seller.id, {
      pointId: b.point.id,
      actual: [
        { productId: b.pine.id, qty: 0 },
        { productId: b.fir.id, qty: 0 },
      ],
    }),
  );
});

const tx = prisma.$transaction.bind(prisma) as typeof prisma.$transaction;
const lines = (pine: number, fir: number) => [
  { productId: b.pine.id, qty: pine },
  { productId: b.fir.id, qty: fir },
];

// Заявка продавца на 20 сосен и 10 пихт, утверждённая как есть
async function approvedTrip(pine = 20, fir = 10) {
  const request = await tx((t) =>
    createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(pine, fir) }),
  );
  return tx((t) =>
    approveRequest(t, b.manager.id, {
      requestId: request.id,
      driverId: b.driver.id,
      items: lines(pine, fir),
    }),
  );
}

async function deliveredTrip(loaded = lines(20, 10), unloaded = loaded) {
  const trip = await approvedTrip();
  await tx((t) => confirmLoad(t, b.driver.id, trip.id, loaded));
  await tx((t) => depart(t, b.driver.id, trip.id));
  await tx((t) => confirmUnload(t, b.driver.id, trip.id, unloaded));
  return trip;
}

const incidents = () => prisma.incident.findMany({ orderBy: { id: "asc" } });

describe("заявка", () => {
  it("продавец создаёт заявку только на свою точку", async () => {
    const stranger = await tx((t) =>
      createUser(t, b.manager.id, {
        login: "other",
        fullName: "Чужой продавец",
        role: Role.SELLER,
        password: "secret123",
        pointIds: [],
      }),
    );
    await expect(
      tx((t) => createRequest(t, stranger.id, { pointId: b.point.id, items: lines(1, 0) })),
    ).rejects.toThrow(DomainError);
    await expect(
      tx((t) => createRequest(t, b.driver.id, { pointId: b.point.id, items: lines(1, 0) })),
    ).rejects.toThrow(DomainError);
  });

  it("пустая заявка отклоняется", async () => {
    await expect(
      tx((t) => createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(0, 0) })),
    ).rejects.toThrow(DomainError);
  });

  it("создание заявки не меняет остатки", async () => {
    await tx((t) => createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(20, 10) }));
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(100);
    expect(await balance(b.loc.point, b.pine.id)).toBe(0);
  });

  it("менеджер может утвердить меньше запрошенного", async () => {
    const request = await tx((t) =>
      createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(20, 10) }),
    );
    const trip = await tx((t) =>
      approveRequest(t, b.manager.id, {
        requestId: request.id,
        driverId: b.driver.id,
        items: lines(15, 0),
      }),
    );

    const items = await prisma.tripItem.findMany({ where: { tripId: trip.id } });
    expect(items.map((i) => [i.productId, i.qtyPlanned])).toEqual([[b.pine.id, 15]]);
    const requestItems = await prisma.requestItem.findMany({
      where: { requestId: request.id },
      orderBy: { productId: "asc" },
    });
    expect(requestItems.map((i) => [i.qtyRequested, i.qtyApproved])).toEqual([
      [20, 15],
      [10, 0],
    ]);
    // Утверждение ещё ничего не перемещает
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(100);
  });

  it("нельзя утвердить больше, чем свободно на складе с учётом других рейсов", async () => {
    await approvedTrip(70, 0);
    const request = await tx((t) =>
      createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(40, 0) }),
    );
    const approve = (pine: number) =>
      tx((t) =>
        approveRequest(t, b.manager.id, {
          requestId: request.id,
          driverId: b.driver.id,
          items: lines(pine, 0),
        }),
      );

    await expect(approve(40)).rejects.toThrow("свободно 30");
    await approve(30);
  });

  it("заявку нельзя рассмотреть дважды", async () => {
    const trip = await approvedTrip();
    await expect(
      tx((t) =>
        approveRequest(t, b.manager.id, {
          requestId: trip.requestId,
          driverId: b.driver.id,
          items: lines(1, 1),
        }),
      ),
    ).rejects.toThrow(DomainError);
    await expect(tx((t) => rejectRequest(t, b.manager.id, trip.requestId, "нет"))).rejects.toThrow(
      DomainError,
    );
    expect(await prisma.trip.count()).toBe(1);
  });

  it("отказ требует причину и не создаёт рейс", async () => {
    const request = await tx((t) =>
      createRequest(t, b.seller.id, { pointId: b.point.id, items: lines(5, 0) }),
    );
    await expect(tx((t) => rejectRequest(t, b.manager.id, request.id, " "))).rejects.toThrow(
      DomainError,
    );
    await tx((t) => rejectRequest(t, b.manager.id, request.id, "на точке достаточно"));

    const saved = await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(saved.status).toBe("REJECTED");
    expect(await prisma.trip.count()).toBe(0);
  });

  it("менеджер может создать завоз без заявки продавца", async () => {
    const trip = await tx((t) =>
      createDelivery(t, b.manager.id, {
        pointId: b.point.id,
        driverId: b.driver.id,
        items: lines(10, 0),
      }),
    );
    expect(trip.status).toBe("ASSIGNED");
    expect(trip.pointId).toBe(b.point.id);
  });
});

describe("рейс без расхождений", () => {
  it("товар проходит путь склад -> водитель -> точка, инцидентов нет", async () => {
    const trip = await approvedTrip();

    await tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(20, 10)));
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(80);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(20);
    expect(await balance(b.loc.driver, b.fir.id)).toBe(10);

    await tx((t) => depart(t, b.driver.id, trip.id));
    await tx((t) => confirmUnload(t, b.driver.id, trip.id, lines(20, 10)));
    // До подтверждения продавцом товар числится на водителе
    expect(await balance(b.loc.driver, b.pine.id)).toBe(20);
    expect(await balance(b.loc.point, b.pine.id)).toBe(0);

    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(20, 10)));
    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
    expect(await balance(b.loc.driver, b.fir.id)).toBe(0);
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
    expect(await balance(b.loc.point, b.fir.id)).toBe(10);

    expect(await incidents()).toEqual([]);
    const saved = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: { request: true },
    });
    expect(saved.status).toBe("ACCEPTED");
    expect(saved.acceptedById).toBe(b.seller.id);
    expect(saved.request.status).toBe("DONE");
    expect(await findNegativeBalances(prisma)).toEqual([]);
  });
});

describe("загрузка", () => {
  it("расхождение с утверждённым количеством создаёт инцидент на водителя", async () => {
    const trip = await approvedTrip();
    await tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(18, 10)));

    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(82);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(18);
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "LOAD_MISMATCH",
      status: "OPEN",
      userId: b.driver.id,
      pointId: b.point.id,
      productId: b.pine.id,
      qty: -2,
      tripId: trip.id,
    });
  });

  it("нельзя загрузить больше, чем есть на складе", async () => {
    const trip = await approvedTrip();
    await expect(
      tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(101, 10))),
    ).rejects.toThrow(DomainError);
    // Транзакция откатилась целиком: пихта тоже не ушла
    expect(await balance(b.loc.warehouse, b.fir.id)).toBe(50);
    expect(await balance(b.loc.driver, b.fir.id)).toBe(0);
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe(
      "ASSIGNED",
    );
  });

  it("чужой водитель не может загрузить рейс", async () => {
    const other = await tx((t) =>
      createUser(t, b.manager.id, {
        login: "driver2",
        fullName: "Другой водитель",
        role: Role.DRIVER,
        password: "secret123",
        pointIds: [],
      }),
    );
    const trip = await approvedTrip();
    await expect(tx((t) => confirmLoad(t, other.id, trip.id, lines(20, 10)))).rejects.toThrow(
      DomainError,
    );
  });

  it("повторное подтверждение загрузки не перемещает товар второй раз", async () => {
    const trip = await approvedTrip();
    const results = await Promise.allSettled([
      tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(20, 10))),
      tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(20, 10))),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(20);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(80);
  });

  it("количество нужно указать по каждому виду из рейса", async () => {
    const trip = await approvedTrip();
    await expect(
      tx((t) => confirmLoad(t, b.driver.id, trip.id, [{ productId: b.pine.id, qty: 20 }])),
    ).rejects.toThrow(DomainError);
    await expect(
      tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(0, 0))),
    ).rejects.toThrow(DomainError);
  });

  it("отменить можно только незагруженный рейс", async () => {
    const trip = await approvedTrip();
    await tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(20, 10)));
    await expect(tx((t) => cancelTrip(t, b.manager.id, trip.id, "передумали"))).rejects.toThrow(
      DomainError,
    );

    const second = await approvedTrip(5, 0);
    await tx((t) => cancelTrip(t, b.manager.id, second.id, "передумали"));
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "CANCELLED",
    );
  });
});

describe("порядок шагов", () => {
  it("шаги нельзя пропускать", async () => {
    const trip = await approvedTrip();
    await expect(tx((t) => depart(t, b.driver.id, trip.id))).rejects.toThrow(DomainError);
    await expect(
      tx((t) => confirmUnload(t, b.driver.id, trip.id, lines(20, 10))),
    ).rejects.toThrow(DomainError);
    await expect(
      tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(20, 10))),
    ).rejects.toThrow(DomainError);

    await tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(20, 10)));
    await expect(
      tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(20, 10))),
    ).rejects.toThrow(DomainError);
    expect(await balance(b.loc.point, b.pine.id)).toBe(0);
  });

  it("водитель не может выгрузить больше, чем загрузил", async () => {
    const trip = await approvedTrip();
    await tx((t) => confirmLoad(t, b.driver.id, trip.id, lines(20, 10)));
    await tx((t) => depart(t, b.driver.id, trip.id));
    await expect(
      tx((t) => confirmUnload(t, b.driver.id, trip.id, lines(21, 10))),
    ).rejects.toThrow(DomainError);
  });
});

describe("приём на точке", () => {
  it("продавец принял меньше: разница остаётся на водителе и создаётся инцидент", async () => {
    const trip = await deliveredTrip();
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(17, 10)));

    expect(await balance(b.loc.point, b.pine.id)).toBe(17);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(3);
    expect(await balance(b.loc.point, b.fir.id)).toBe(10);
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "DELIVERY_MISMATCH",
      userId: b.driver.id,
      secondUserId: b.seller.id,
      pointId: b.point.id,
      productId: b.pine.id,
      qty: -3,
    });
  });

  it("расхождение даже в один ствол фиксируется", async () => {
    const trip = await deliveredTrip();
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(20, 9)));

    const list = await incidents();
    expect(list.map((i) => [i.productId, i.qty])).toEqual([[b.fir.id, -1]]);
  });

  it("водитель привёз часть обратно: остаток на нём, инцидента нет", async () => {
    const trip = await deliveredTrip(lines(20, 10), lines(15, 10));
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(15, 10)));

    expect(await balance(b.loc.point, b.pine.id)).toBe(15);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(5);
    expect(await incidents()).toEqual([]);
  });

  it("продавец заявил больше загруженного: на точку проводится не больше загруженного", async () => {
    const trip = await deliveredTrip();
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(22, 10)));

    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0].qty).toBe(2);
    expect(await findNegativeBalances(prisma)).toEqual([]);
  });

  it("принять может только продавец этой точки", async () => {
    const trip = await deliveredTrip();
    await expect(
      tx((t) => acceptDelivery(t, b.driver.id, trip.id, lines(20, 10))),
    ).rejects.toThrow(DomainError);
    await expect(
      tx((t) => acceptDelivery(t, b.manager.id, trip.id, lines(20, 10))),
    ).rejects.toThrow(DomainError);
  });

  it("повторный приём не перемещает товар второй раз", async () => {
    const trip = await deliveredTrip();
    const results = await Promise.allSettled([
      tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(20, 10))),
      tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(20, 10))),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(b.loc.point, b.pine.id)).toBe(20);
  });

  it("сумма по всем местам сохраняется при любых расхождениях", async () => {
    const trip = await deliveredTrip(lines(18, 10), lines(16, 10));
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(14, 9)));

    const pine =
      (await balance(b.loc.warehouse, b.pine.id)) +
      (await balance(b.loc.driver, b.pine.id)) +
      (await balance(b.loc.point, b.pine.id));
    const fir =
      (await balance(b.loc.warehouse, b.fir.id)) +
      (await balance(b.loc.driver, b.fir.id)) +
      (await balance(b.loc.point, b.fir.id));
    expect(pine).toBe(100);
    expect(fir).toBe(50);
    expect(await balance(b.loc.driver, b.pine.id)).toBe(4);
    expect(await balance(b.loc.driver, b.fir.id)).toBe(1);
  });
});

describe("возврат и разбор", () => {
  it("менеджер принимает остаток водителя на склад", async () => {
    const trip = await deliveredTrip(lines(20, 10), lines(15, 10));
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(15, 10)));
    await tx((t) =>
      acceptReturn(t, b.manager.id, { driverId: b.driver.id, items: lines(5, 0) }),
    );

    expect(await balance(b.loc.driver, b.pine.id)).toBe(0);
    expect(await balance(b.loc.warehouse, b.pine.id)).toBe(85);
  });

  it("нельзя принять от водителя больше, чем за ним числится", async () => {
    await expect(
      tx((t) => acceptReturn(t, b.manager.id, { driverId: b.driver.id, items: lines(1, 0) })),
    ).rejects.toThrow(DomainError);
  });

  it("инцидент закрывается только с решением и только один раз", async () => {
    const trip = await deliveredTrip();
    await tx((t) => acceptDelivery(t, b.seller.id, trip.id, lines(19, 10)));
    const [incident] = await incidents();

    await expect(tx((t) => resolveIncident(t, b.manager.id, { incidentId: incident.id, action: "CHARGE", resolution: "" }))).rejects.toThrow(
      DomainError,
    );
    await tx((t) =>
      resolveIncident(t, b.manager.id, {
        incidentId: incident.id,
        action: "CHARGE",
        resolution: "удержано с водителя",
      }),
    );
    const saved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(saved).toMatchObject({
      status: "RESOLVED",
      resolution: "удержано с водителя",
      resolvedById: b.manager.id,
    });
    await expect(
      tx((t) =>
        resolveIncident(t, b.manager.id, {
          incidentId: incident.id,
          action: "CHARGE",
          resolution: "ещё раз",
        }),
      ),
    ).rejects.toThrow(DomainError);
  });
});
