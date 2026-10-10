import "server-only";
import ExcelJS from "exceljs";

export type Sheet = {
  name: string;
  columns: { header: string; width?: number; money?: boolean }[];
  rows: (string | number | Date | null | undefined)[][];
};

// Собирает .xlsx из нескольких листов и отдаёт как файл для скачивания.
export async function xlsxResponse(fileName: string, sheets: Sheet[]) {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      width: c.width ?? Math.max(12, c.header.length + 2),
      style: c.money ? { numFmt: '#,##0 "₽"' } : {},
    }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of sheet.rows) ws.addRow(row.map((v) => v ?? ""));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}
