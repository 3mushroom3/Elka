import Link from "next/link";
import { MobileShell } from "@/components/MobileShell";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, TRIP_STATUS_LABEL } from "@/lib/labels";

// Полная история рейсов водителя: на главной помещаются только последние.
export default async function DriverTripsPage() {
  const user = await requireRole("DRIVER");
  const trips = await prisma.trip.findMany({
    where: { driverId: user.id, status: { in: ["ACCEPTED", "CANCELLED"] } },
    orderBy: { id: "desc" },
    include: {
      point: { select: { name: true } },
      items: { select: { qtyLoaded: true, qtyReceived: true } },
    },
  });

  return (
    <MobileShell title="История рейсов" backHref="/driver">
      {trips.length === 0 && <div className="card">Завершённых рейсов пока нет.</div>}
      {trips.map((t) => {
        const loaded = t.items.reduce((a, i) => a + (i.qtyLoaded ?? 0), 0);
        const received = t.items.reduce((a, i) => a + (i.qtyReceived ?? 0), 0);
        const mismatch = t.status === "ACCEPTED" && loaded !== received;
        return (
          <Link key={t.id} href={`/driver/trip/${t.id}`} className="card block active:scale-[0.98]">
            <p className="text-sm text-zinc-500">
              Рейс №{t.id} · {TRIP_STATUS_LABEL[t.status].toLowerCase()}
            </p>
            <p className="text-lg font-bold">{t.point.name}</p>
            <p className="text-sm text-zinc-500">
              {t.acceptedAt ? formatDateTime(t.acceptedAt) : formatDateTime(t.createdAt)}
            </p>
            {t.status === "ACCEPTED" && (
              <p className={`mt-1 ${mismatch ? "font-semibold text-red-600" : "text-zinc-600"}`}>
                загружено {loaded}, принято {received}
                {mismatch && " — расхождение"}
              </p>
            )}
          </Link>
        );
      })}
    </MobileShell>
  );
}
