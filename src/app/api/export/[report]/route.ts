import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { xlsxResponse } from "@/lib/excel";
import { REPORTS } from "@/lib/export-sheets";

// Выгрузка отчётов в Excel. Доступна только менеджеру.
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "MANAGER") return new Response("Нет доступа", { status: 403 });
  const report = REPORTS[(await params).report];
  if (!report) return new Response("Нет такого отчёта", { status: 404 });
  const sheets = await report.build(request.nextUrl.searchParams);
  return xlsxResponse(report.file, sheets);
}
