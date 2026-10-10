import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CountDiffs } from "@/components/CountDiffs";
import { MobileShell } from "@/components/MobileShell";
import { currentShift } from "@/domain/shift";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  formatDateTime,
  formatMoney,
  formatTime,
  REQUEST_STATUS_LABEL,
  TRIP_STATUS_LABEL,
  WRITEOFF_STATUS_LABEL,
} from "@/lib/labels";
import { shiftCountDiffs, shiftSummary } from "@/lib/shift-summary";

export default async function SellerHome() {
  const user = await requireRole("SELLER");
  const [points, shift] = await Promise.all([
    prisma.point.findMany({
      where: { isActive: true, sellers: { some: { userId: user.id } } },
      orderBy: { name: "asc" },
    }),
    currentShift(prisma, user.id),
  ]);
  const pointIds = points.map((p) => p.id);

  const [toAccept, onTheWay, requests, summary, counts, lastClosed] = await Promise.all([
    prisma.trip.findMany({
      where: { pointId: { in: pointIds }, status: "DELIVERED" },
      orderBy: { deliveredAt: "asc" },
      include: { driver: { select: { fullName: true } }, point: { select: { name: true } } },
    }),
    prisma.trip.findMany({
      where: { pointId: { in: pointIds }, status: { in: ["ASSIGNED", "LOADED", "IN_TRANSIT"] } },
      orderBy: { id: "asc" },
      include: { driver: { select: { fullName: true } }, point: { select: { name: true } } },
    }),
    prisma.deliveryRequest.findMany({
      where: { pointId: { in: pointIds }, createdById: user.id },
      orderBy: { id: "desc" },
      take: 5,
      include: {
        point: { select: { name: true } },
        items: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } },
      },
    }),
    shift ? shiftSummary(shift.id) : null,
    shift ? shiftCountDiffs(shift.id) : [],
    shift
      ? null
      : prisma.shift.findFirst({
          where: { sellerId: user.id, status: "CLOSED" },
          orderBy: { id: "desc" },
        }),
  ]);
  const writeoffs = shift
    ? await prisma.writeoffRequest.findMany({
        where: { shiftId: shift.id },
        orderBy: { id: "desc" },
        include: { product: { select: { name: true } } },
      })
    : [];
  const lastCounts = lastClosed ? await shiftCountDiffs(lastClosed.id) : [];
  const shiftPoint = shift && points.find((p) => p.id === shift.pointId);
  const title = shiftPoint?.name ?? (points.map((p) => p.name).join(", ") || "Продавец");
  const big = "btn min-h-20 text-2xl";

  return (
    <MobileShell title={title} userName={user.fullName}>
      <AutoRefresh />
      {points.length === 0 && (
        <div className="card">Вам не назначена точка. Обратитесь к менеджеру.</div>
      )}

      {/* Смена не открыта */}
      {!shift && points.length > 0 && (
        <>
          <Link href="/seller/open" className={big}>
            Открыть смену
          </Link>
          <p className="text-center text-sm text-zinc-500">
            Продажи и приём доставки доступны после утреннего пересчёта.
          </p>
        </>
      )}

      {/* Смена открыта */}
      {shift?.status === "OPEN" && (
        <>
          <Link href="/seller/sale" className={big}>
            Продажа
          </Link>
          {toAccept.map((t) => (
            <Link
              key={t.id}
              href={`/seller/accept/${t.id}`}
              className="rounded-xl bg-amber-500 p-4 text-white shadow-sm active:scale-[0.98]"
            >
              <p className="text-xl font-bold">Принять доставку</p>
              <p>
                Рейс №{t.id} · водитель {t.driver.fullName}
              </p>
            </Link>
          ))}
          <Link href="/seller/sales" className="card block active:bg-zinc-50">
            <p className="flex justify-between text-lg">
              <span>Продано за смену</span>
              <span className="font-bold tabular-nums">{summary!.qty} шт.</span>
            </p>
            <p className="flex justify-between text-lg">
              <span>Выручка</span>
              <span className="font-bold tabular-nums">{formatMoney(summary!.revenue)}</span>
            </p>
            <p className="flex justify-between text-emerald-800">
              <span>Мой заработок</span>
              <span className="font-bold tabular-nums">{formatMoney(summary!.commission)}</span>
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Смена открыта в {formatTime(shift.openedAt)} · все продажи ›
            </p>
          </Link>
          <CountDiffs counts={counts} />
          {writeoffs.length > 0 && (
            <section className="card">
              <h2 className="h2">Списания за смену</h2>
              {writeoffs.map((w) => (
                <p key={w.id} className="border-b border-zinc-100 py-2 last:border-0">
                  <span className="flex justify-between gap-2">
                    <span>
                      {w.product.name} × {w.qty}
                    </span>
                    <span
                      className={
                        w.status === "PENDING"
                          ? "text-amber-600"
                          : w.status === "APPROVED"
                            ? "text-emerald-700"
                            : "text-red-600"
                      }
                    >
                      {WRITEOFF_STATUS_LABEL[w.status]}
                    </span>
                  </span>
                  {w.decisionComment && (
                    <span className="block text-sm text-zinc-500">{w.decisionComment}</span>
                  )}
                </p>
              ))}
            </section>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Link href="/seller/request" className="btn-secondary min-h-16 text-base">
              Заявка на завоз
            </Link>
            <Link href="/seller/writeoff" className="btn-secondary min-h-16 text-base">
              Списание
            </Link>
            <Link href="/seller/close" className="btn-secondary min-h-16 text-base">
              Закрыть смену
            </Link>
          </div>
        </>
      )}

      {/* Пересчёт сдан, осталось сдать деньги */}
      {shift?.status === "COUNTED" && (
        <Link href="/seller/cash" className={big}>
          Сдать деньги и закрыть смену
        </Link>
      )}

      {/* Доставку привезли, а смена не открыта */}
      {!shift && toAccept.length > 0 && (
        <div className="rounded-xl bg-amber-100 p-4 text-amber-900">
          Водитель выгрузил товар (рейс №{toAccept.map((t) => t.id).join(", №")}). Откройте смену,
          чтобы принять доставку.
        </div>
      )}

      {lastClosed && (
        <section className="card">
          <h2 className="h2">Прошлая смена</h2>
          <p className="text-sm text-zinc-500">
            Закрыта {lastClosed.closedAt && formatDateTime(lastClosed.closedAt)}
          </p>
          <p className="mt-1">
            Наличные: должно быть {formatMoney(lastClosed.cashExpected ?? 0)}, сдано{" "}
            {formatMoney(lastClosed.cashActual ?? 0)}
            {lastClosed.cashActual !== lastClosed.cashExpected && (
              <span className="font-semibold text-red-700">
                {" "}
                (разница {formatMoney((lastClosed.cashActual ?? 0) - (lastClosed.cashExpected ?? 0))})
              </span>
            )}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <CountDiffs counts={lastCounts} />
          </div>
        </section>
      )}

      {onTheWay.length > 0 && (
        <section className="card">
          <h2 className="h2">Едет к вам</h2>
          {onTheWay.map((t) => (
            <p key={t.id} className="border-b border-zinc-100 py-2 last:border-0">
              Рейс №{t.id}: {TRIP_STATUS_LABEL[t.status].toLowerCase()}
              <span className="block text-sm text-zinc-500">
                водитель {t.driver.fullName}
                {points.length > 1 && ` · ${t.point.name}`}
              </span>
            </p>
          ))}
        </section>
      )}

      {requests.length > 0 && (
        <section className="card">
          <h2 className="h2">Мои заявки</h2>
          {requests.map((r) => (
            <div key={r.id} className="border-b border-zinc-100 py-2 last:border-0">
              <p className="flex justify-between gap-2">
                <span className="font-semibold">№{r.id}</span>
                <span
                  className={
                    r.status === "REJECTED" || r.status === "CANCELLED"
                      ? "text-red-600"
                      : r.status === "NEW"
                        ? "text-amber-600"
                        : "text-emerald-700"
                  }
                >
                  {REQUEST_STATUS_LABEL[r.status]}
                </span>
              </p>
              <p className="text-sm text-zinc-500">
                {formatDateTime(r.createdAt)}
                {points.length > 1 && ` · ${r.point.name}`}
              </p>
              <p className="text-sm">
                {r.items
                  .filter((i) => i.qtyRequested > 0)
                  .map((i) => `${i.product.name}: ${i.qtyRequested}`)
                  .join(", ")}
              </p>
              {r.rejectReason && <p className="text-sm text-red-600">{r.rejectReason}</p>}
            </div>
          ))}
        </section>
      )}

      {!shift && points.length > 0 && (
        <Link href="/seller/request" className="btn-secondary min-h-14">
          Заявка на завоз
        </Link>
      )}
    </MobileShell>
  );
}
