import "server-only";
import { getAllBalances } from "@/domain/ledger";
import { type ReportRow, salesReport } from "@/domain/reports";
import { summarizeShortages } from "@/domain/shortage";
import { prisma } from "@/lib/db";
import type { Sheet } from "@/lib/excel";
import {
  addDays,
  INCIDENT_LABEL,
  locationName,
  MOVEMENT_LABEL,
  parseDay,
  PAYMENT_LABEL,
  ROLE_LABEL,
  SHIFT_STATUS_LABEL,
} from "@/lib/labels";
import { listLocations, listProducts } from "@/lib/queries";

const MAX_ROWS = 50_000;

function period(params: URLSearchParams) {
  const from = parseDay(params.get("from") ?? undefined);
  const to = parseDay(params.get("to") ?? undefined);
  return { from, to: to ? addDays(to, 1) : undefined };
}

const id = (params: URLSearchParams, name: string) => Number(params.get(name)) || undefined;

async function salesSheets(params: URLSearchParams): Promise<Sheet[]> {
  const { from, to } = period(params);
  const items = await prisma.saleItem.findMany({
    where: {
      productId: id(params, "product"),
      sale: {
        pointId: id(params, "point"),
        sellerId: id(params, "seller"),
        createdAt: { gte: from, lt: to },
      },
    },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
    include: {
      product: { select: { name: true } },
      sale: {
        include: { point: { select: { name: true } }, seller: { select: { fullName: true } } },
      },
    },
  });
  return [
    {
      name: "Продажи",
      columns: [
        { header: "№ продажи" },
        { header: "Дата и время", width: 18 },
        { header: "Точка", width: 24 },
        { header: "Продавец", width: 24 },
        { header: "Вид", width: 20 },
        { header: "Кол-во" },
        { header: "Цена на стикере", money: true },
        { header: "Цена продажи", money: true },
        { header: "Сумма", money: true },
        { header: "Оплата" },
        { header: "Продавцу, %" },
        { header: "Начислено продавцу", money: true },
        { header: "Причина скидки", width: 24 },
        { header: "Отменена" },
      ],
      rows: items.map((i) => [
        i.saleId,
        i.sale.createdAt,
        i.sale.point.name,
        i.sale.seller.fullName,
        i.product.name,
        i.qty,
        i.stickerPrice,
        i.price,
        i.price * i.qty,
        PAYMENT_LABEL[i.sale.payment],
        i.commissionPercent,
        i.sale.cancelStatus === "CANCELLED" ? 0 : i.commission,
        i.discountReason,
        i.sale.cancelStatus === "CANCELLED" ? "да" : "",
      ]),
    },
  ];
}

async function summarySheets(params: URLSearchParams): Promise<Sheet[]> {
  const report = await salesReport(prisma, period(params));
  const sheet = (name: string, first: string, rows: ReportRow[]): Sheet => ({
    name,
    columns: [
      { header: first, width: 28 },
      { header: "Продано, шт." },
      { header: "Выручка", money: true },
      { header: "Начислено продавцам", money: true },
    ],
    rows: [
      ...rows.map((r) => [r.label, r.qty, r.revenue, r.commission]),
      ["Итого", report.total.qty, report.total.revenue, report.total.commission],
    ],
  });
  return [
    sheet("По точкам", "Точка", report.byPoint),
    sheet("По продавцам", "Продавец", report.bySeller),
    sheet("По дням", "День", report.byDay),
    sheet("По видам", "Вид", report.byProduct),
  ];
}

async function shiftsSheets(params: URLSearchParams): Promise<Sheet[]> {
  const shifts = await prisma.shift.findMany({
    where: { pointId: id(params, "point"), sellerId: id(params, "seller") },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
    include: {
      point: { select: { name: true } },
      seller: { select: { fullName: true } },
      counts: {
        include: { items: { include: { product: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      },
      sales: {
        where: { cancelStatus: { not: "CANCELLED" } },
        select: { total: true, items: { select: { qty: true } } },
      },
    },
  });
  return [
    {
      name: "Смены",
      columns: [
        { header: "№ смены" },
        { header: "Точка", width: 24 },
        { header: "Продавец", width: 24 },
        { header: "Статус", width: 22 },
        { header: "Открыта", width: 18 },
        { header: "Закрыта", width: 18 },
        { header: "Продано, шт." },
        { header: "Выручка", money: true },
        { header: "Наличные по продажам", money: true },
        { header: "Наличные сдано", money: true },
        { header: "Расхождение наличных", money: true },
        { header: "Наличные получены" },
        { header: "Стикеры сверены" },
      ],
      rows: shifts.map((s) => [
        s.id,
        s.point.name,
        s.seller.fullName,
        SHIFT_STATUS_LABEL[s.status],
        s.openedAt,
        s.closedAt,
        s.sales.reduce((n, sale) => n + sale.items.reduce((q, i) => q + i.qty, 0), 0),
        s.sales.reduce((n, sale) => n + sale.total, 0),
        s.cashExpected,
        s.cashActual,
        s.cashActual === null ? null : s.cashActual - (s.cashExpected ?? 0),
        s.cashReceivedAt ? "да" : "",
        s.stickersCheckedAt ? "да" : "",
      ]),
    },
    {
      name: "Пересчёты",
      columns: [
        { header: "№ смены" },
        { header: "Точка", width: 24 },
        { header: "Продавец", width: 24 },
        { header: "Пересчёт" },
        { header: "Время", width: 18 },
        { header: "Вид", width: 20 },
        { header: "По учёту" },
        { header: "По факту" },
        { header: "Разница" },
      ],
      rows: shifts.flatMap((s) =>
        s.counts.flatMap((c) =>
          c.items.map((i) => [
            s.id,
            s.point.name,
            s.seller.fullName,
            c.kind === "MORNING" ? "Утро" : "Вечер",
            c.createdAt,
            i.product.name,
            i.qtyExpected,
            i.qtyActual,
            i.diff,
          ]),
        ),
      ),
    },
  ];
}

async function movementsSheets(params: URLSearchParams): Promise<Sheet[]> {
  const { from, to } = period(params);
  const place = { include: { point: true, driver: true } } as const;
  const movements = await prisma.movement.findMany({
    where: { createdAt: { gte: from, lt: to } },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
    include: {
      product: { select: { name: true } },
      author: { select: { fullName: true } },
      from: place,
      to: place,
    },
  });
  return [
    {
      name: "Журнал движений",
      columns: [
        { header: "№" },
        { header: "Дата и время", width: 18 },
        { header: "Тип", width: 22 },
        { header: "Вид", width: 20 },
        { header: "Кол-во" },
        { header: "Откуда", width: 28 },
        { header: "Куда", width: 28 },
        { header: "Кто", width: 24 },
        { header: "Причина", width: 50 },
      ],
      rows: movements.map((m) => [
        m.id,
        m.createdAt,
        MOVEMENT_LABEL[m.type],
        m.product.name,
        m.qty,
        locationName(m.from),
        locationName(m.to),
        m.author.fullName,
        m.reason,
      ]),
    },
  ];
}

async function shortagesSheets(): Promise<Sheet[]> {
  const [incidents, users] = await Promise.all([
    prisma.incident.findMany({
      orderBy: { id: "asc" },
      include: {
        point: { select: { name: true } },
        user: { select: { fullName: true } },
        chargedUser: { select: { fullName: true } },
        product: { select: { name: true } },
      },
    }),
    prisma.user.findMany(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  return [
    {
      name: "По сотрудникам",
      columns: [
        { header: "Сотрудник", width: 26 },
        { header: "Роль" },
        { header: "Стволы: записано" },
        { header: "Стволы: на разборе" },
        { header: "Деньги: записано", money: true },
        { header: "Деньги: на разборе", money: true },
        { header: "Скидки ниже стикера", money: true },
        { header: "Снято инцидентов" },
      ],
      rows: summarizeShortages(incidents).map((r) => [
        userById.get(r.userId)?.fullName,
        ROLE_LABEL[userById.get(r.userId)!.role],
        r.stemsCharged,
        r.stemsOpen,
        r.cashCharged,
        r.cashOpen,
        r.discounts,
        r.dismissed,
      ]),
    },
    {
      name: "Инциденты",
      columns: [
        { header: "№" },
        { header: "Дата", width: 18 },
        { header: "Тип", width: 30 },
        { header: "Точка", width: 24 },
        { header: "Вид", width: 20 },
        { header: "Кол-во" },
        { header: "Сумма", money: true },
        { header: "Описание", width: 60 },
        { header: "Ответственный", width: 24 },
        { header: "Статус" },
        { header: "Записано на", width: 24 },
        { header: "Решение", width: 50 },
      ],
      rows: incidents.map((i) => [
        i.id,
        i.createdAt,
        INCIDENT_LABEL[i.type],
        i.point?.name,
        i.product?.name,
        i.qty,
        i.amount,
        i.description,
        i.user?.fullName,
        i.status === "OPEN" ? "Открыт" : "Закрыт",
        i.chargedUser?.fullName,
        i.resolution,
      ]),
    },
  ];
}

async function stockSheets(): Promise<Sheet[]> {
  const [products, locations, balances] = await Promise.all([
    listProducts(false),
    listLocations(),
    getAllBalances(prisma),
  ]);
  return [
    {
      name: "Остатки",
      columns: [{ header: "Место", width: 32 }, ...products.map((p) => ({ header: p.name }))],
      rows: locations
        .filter((l) => l.type !== "SUPPLIER")
        .map((l) => [
          locationName(l),
          ...products.map((p) => balances.get(l.id)?.get(p.id) ?? 0),
        ]),
    },
  ];
}

// Все выгрузки: имя файла и сборка листов по параметрам запроса
export const REPORTS: Record<string, { file: string; build: (p: URLSearchParams) => Promise<Sheet[]> }> = {
  sales: { file: "Продажи", build: salesSheets },
  summary: { file: "Отчёт по продажам", build: summarySheets },
  shifts: { file: "Смены и пересчёты", build: shiftsSheets },
  movements: { file: "Журнал движений", build: movementsSheets },
  shortages: { file: "Недостачи", build: shortagesSheets },
  stock: { file: "Остатки", build: stockSheets },
};
