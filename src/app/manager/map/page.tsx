import { type MapPoint, PointsMap, type MapTrip } from "@/components/PointsMap";
import { PageHeader } from "@/components/ui";
import { getAllBalances } from "@/domain/ledger";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dayStart, TRIP_STATUS_LABEL } from "@/lib/labels";

// Карта точек и рейсов. Трек пишется телефоном водителя, пока рейс в работе.
export default async function MapPage() {
  await requireRole("MANAGER");
  const today = dayStart();

  const [points, trips, balances, sales, shifts] = await Promise.all([
    prisma.point.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      orderBy: { name: "asc" },
      include: { location: { select: { id: true } } },
    }),
    prisma.trip.findMany({
      where: { status: { in: ["LOADED", "IN_TRANSIT", "DELIVERED"] } },
      include: {
        driver: { select: { fullName: true } },
        point: { select: { name: true } },
        track: { orderBy: { recordedAt: "asc" } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.$transaction((tx) => getAllBalances(tx)),
    prisma.sale.groupBy({
      by: ["pointId"],
      where: { createdAt: { gte: today }, cancelStatus: { not: "CANCELLED" } },
      _sum: { total: true },
    }),
    prisma.shift.findMany({
      where: { openedAt: { gte: today } },
      select: { pointId: true, status: true },
    }),
  ]);

  const soldItems = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: today }, cancelStatus: { not: "CANCELLED" } } },
    select: { qty: true, sale: { select: { pointId: true } } },
  });
  const qtyByPoint = new Map<number, number>();
  for (const i of soldItems) {
    qtyByPoint.set(i.sale.pointId, (qtyByPoint.get(i.sale.pointId) ?? 0) + i.qty);
  }
  const revenueByPoint = new Map(sales.map((s) => [s.pointId, s._sum.total ?? 0]));
  const shiftByPoint = new Map(shifts.map((s) => [s.pointId, s.status]));

  const mapPoints: MapPoint[] = points.map((p) => {
    const stock = [...(balances.get(p.location?.id ?? -1)?.values() ?? [])].reduce(
      (a, b) => a + b,
      0,
    );
    const status = shiftByPoint.get(p.id);
    return {
      id: p.id,
      name: p.name,
      address: p.address,
      latitude: p.latitude!,
      longitude: p.longitude!,
      isActive: p.isActive,
      stock,
      soldToday: qtyByPoint.get(p.id) ?? 0,
      revenueToday: revenueByPoint.get(p.id) ?? 0,
      shift:
        status === "OPEN"
          ? "открыта"
          : status === "COUNTED"
            ? "ждёт сдачи денег"
            : status === "CLOSED"
              ? "закрыта"
              : "не открывалась",
    };
  });

  const mapTrips: MapTrip[] = trips.map((t) => ({
    id: t.id,
    driverName: t.driver.fullName,
    pointName: t.point.name,
    status: TRIP_STATUS_LABEL[t.status].toLowerCase(),
    track: t.track.map((l) => [l.longitude, l.latitude] as [number, number]),
    recordedAt: t.track.at(-1)?.recordedAt.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Карта"
        hint="Точки продаж и водители в рейсе. Координаты точки задаются в разделе «Точки»."
      />
      {mapPoints.length === 0 && mapTrips.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Пока нечего показывать: ни у одной точки не заданы координаты и нет рейсов в пути.
        </p>
      ) : (
        <PointsMap points={mapPoints} trips={mapTrips} />
      )}
    </>
  );
}
