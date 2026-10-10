import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recordSale } from "@/domain/sales";
import { closeShift, eveningCount, openShift } from "@/domain/shift";
import { xlsxResponse } from "@/lib/excel";
import { REPORTS } from "@/lib/export-sheets";
import { type Basics, receive, resetDb, seedBasics, transfer } from "./helpers";

let b: Basics;

// Собирает файл так же, как это делает сервер, и читает его обратно
async function build(report: string, query = "") {
  const sheets = await REPORTS[report].build(new URLSearchParams(query));
  const response = await xlsxResponse(REPORTS[report].file, sheets);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return { response, workbook };
}

const rows = (workbook: ExcelJS.Workbook, sheet: string) => {
  const result: unknown[][] = [];
  workbook.getWorksheet(sheet)!.eachRow((row) => {
    result.push((row.values as unknown[]).slice(1));
  });
  return result;
};

// Одна смена: продано 2 сосны по 2000 и пихта за 2500 при стикере 3000; недостача 1 сосна и 500 ₽
beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  await receive(b, b.pine.id, 100);
  await receive(b, b.fir.id, 50);
  await transfer(b, b.pine.id, 20, b.loc.warehouse, b.loc.point);
  await transfer(b, b.fir.id, 10, b.loc.warehouse, b.loc.point);
  const lines = (pine: number, fir: number) => [
    { productId: b.pine.id, qty: pine },
    { productId: b.fir.id, qty: fir },
  ];
  await prisma.$transaction((t) =>
    openShift(t, b.seller.id, { pointId: b.point.id, actual: lines(20, 10) }),
  );
  await prisma.$transaction((t) =>
    recordSale(t, b.seller.id, {
      productId: b.pine.id,
      qty: 2,
      stickerPrice: 2000,
      price: 2000,
      payment: "CASH",
    }),
  );
  await prisma.$transaction((t) =>
    recordSale(t, b.seller.id, {
      productId: b.fir.id,
      qty: 1,
      stickerPrice: 3000,
      price: 2500,
      discountReason: "торг",
      payment: "CARD",
    }),
  );
  await prisma.$transaction((t) => eveningCount(t, b.seller.id, lines(17, 9)));
  await prisma.$transaction((t) => closeShift(t, b.seller.id, 3500));
});

describe("выгрузка в Excel", () => {
  it("отдаёт файл .xlsx с русским именем", async () => {
    const { response } = await build("sales");
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(response.headers.get("Content-Disposition")).toContain(
      encodeURIComponent("Продажи") + ".xlsx",
    );
  });

  it("продажи: по строке на продажу с ценами, оплатой и скидкой", async () => {
    const data = rows((await build("sales")).workbook, "Продажи");
    expect(data[0].slice(0, 6)).toEqual([
      "№ продажи",
      "Дата и время",
      "Точка",
      "Продавец",
      "Вид",
      "Кол-во",
    ]);
    expect(data).toHaveLength(3);
    const pine = data[1];
    expect(pine[1]).toBeInstanceOf(Date);
    expect(pine.slice(2)).toEqual(["Рынок", "Продавец", "Сосна", 2, 2000, 2000, 4000, "Наличные", 10, 400, "", ""]);
    expect(data[2].slice(4)).toEqual(["Пихта", 1, 3000, 2500, 2500, "Карта", 5, 125, "торг", ""]);
  });

  it("продажи: фильтр по виду", async () => {
    const data = rows((await build("sales", `product=${b.fir.id}`)).workbook, "Продажи");
    expect(data.map((r) => r[4])).toEqual(["Вид", "Пихта"]);
  });

  it("сводный отчёт: четыре листа с итогами", async () => {
    const { workbook } = await build("summary");
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      "По точкам",
      "По продавцам",
      "По дням",
      "По видам",
    ]);
    expect(rows(workbook, "По продавцам")).toEqual([
      ["Продавец", "Продано, шт.", "Выручка", "Начислено продавцам"],
      ["Продавец", 3, 6500, 525],
      ["Итого", 3, 6500, 525],
    ]);
    expect(rows(workbook, "По видам").map((r) => r[0])).toEqual(["Вид", "Сосна", "Пихта", "Итого"]);
  });

  it("смены и пересчёты: расхождения по наличным и по стволам", async () => {
    const { workbook } = await build("shifts");
    const shift = rows(workbook, "Смены")[1];
    // продано, выручка, наличные по продажам, сдано, расхождение
    expect(shift.slice(6, 11)).toEqual([3, 6500, 4000, 3500, -500]);
    const counts = rows(workbook, "Пересчёты");
    expect(counts).toHaveLength(5);
    const eveningPine = counts.find((r) => r[3] === "Вечер" && r[5] === "Сосна")!;
    expect(eveningPine.slice(6)).toEqual([18, 17, -1]);
  });

  it("журнал движений, недостачи и остатки собираются", async () => {
    const movements = rows((await build("movements")).workbook, "Журнал движений");
    // 2 прихода, 2 перемещения, 2 продажи, 1 расхождение пересчёта
    expect(movements).toHaveLength(8);
    expect(movements.at(-1)!.slice(2, 7)).toEqual([
      "Расхождение пересчёта",
      "Сосна",
      1,
      "Точка: Рынок",
      "Недостача",
    ]);

    const shortages = (await build("shortages")).workbook;
    expect(rows(shortages, "По сотрудникам")[1]).toEqual([
      "Продавец",
      "Продавец",
      0,
      1,
      0,
      500,
      500,
      0,
    ]);
    expect(rows(shortages, "Инциденты")).toHaveLength(4);

    const stock = rows((await build("stock")).workbook, "Остатки");
    expect(stock[0]).toEqual(["Место", "Сосна", "Пихта"]);
    expect(stock.find((r) => r[0] === "Точка: Рынок")).toEqual(["Точка: Рынок", 17, 9]);
    expect(stock.find((r) => r[0] === "Склад")).toEqual(["Склад", 80, 40]);
  });
});
