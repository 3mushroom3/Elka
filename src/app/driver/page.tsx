import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { MobileShell } from "@/components/MobileShell";
import { getBalances } from "@/domain/ledger";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, TRIP_STATUS_LABEL } from "@/lib/labels";
import { listProducts } from "@/lib/queries";

const NEXT_STEP = {
  ASSIGNED: "Загрузить на складе",
  LOADED: "Отметить выезд",
  IN_TRANSIT: "Отметить выгрузку",
  DELIVERED: "Ждёт приёма продавцом",
} as const;

export default async function DriverHome() {
  const user = await requireRole("DRIVER");
  const location = await prisma.location.findUniqueOrThrow({ where: { driverId: user.id } });
  const tripInclude = { point: { select: { name: true, address: true } } } as const;

  const [active, done, balances, products] = await Promise.all([
    prisma.trip.findMany({
      where: {
        driverId: user.id,
        status: { in: ["ASSIGNED", "LOADED", "IN_TRANSIT", "DELIVERED"] },
      },
      orderBy: { id: "asc" },
      include: tripInclude,
    }),
    prisma.trip.findMany({
      where: { driverId: user.id, status: "ACCEPTED" },
      orderBy: { id: "desc" },
      take: 5,
      include: tripInclude,
    }),
    getBalances(prisma, location.id),
    listProducts(false),
  ]);
  const onHand = products
    .map((p) => ({ name: p.name, qty: balances.get(p.id) ?? 0 }))
    .filter((p) => p.qty !== 0);

  return (
    <MobileShell title="Мои рейсы" userName={user.fullName}>
      <AutoRefresh />
      {active.length === 0 && <div className="card">Назначенных рейсов нет.</div>}
      {active.map((t) => (
        <Link
          key={t.id}
          href={`/driver/trip/${t.id}`}
          className="card block border-l-8 border-l-emerald-600 active:scale-[0.98]"
        >
          <p className="text-sm text-zinc-500">
            Рейс №{t.id} · {TRIP_STATUS_LABEL[t.status].toLowerCase()}
          </p>
          <p className="text-xl font-bold">{t.point.name}</p>
          {t.point.address && <p className="text-zinc-600">{t.point.address}</p>}
          <p className="mt-2 font-semibold text-emerald-700">
            {NEXT_STEP[t.status as keyof typeof NEXT_STEP]} ›
          </p>
        </Link>
      ))}

      <section className="card">
        <h2 className="h2">Числится за мной</h2>
        {onHand.length === 0 ? (
          <p className="text-sm text-zinc-500">Ничего.</p>
        ) : (
          <>
            {onHand.map((p) => (
              <p key={p.name} className="flex justify-between py-1 text-lg">
                <span>{p.name}</span>
                <span className="font-bold tabular-nums">{p.qty}</span>
              </p>
            ))}
            <p className="mt-2 text-sm text-zinc-500">
              Всё, что загружено и не принято продавцом, числится за вами, пока менеджер не примет
              это обратно на склад.
            </p>
          </>
        )}
      </section>

      {done.length > 0 && (
        <section className="card">
          <h2 className="h2">Последние выполненные</h2>
          {done.map((t) => (
            <Link
              key={t.id}
              href={`/driver/trip/${t.id}`}
              className="block border-b border-zinc-100 py-2 last:border-0"
            >
              №{t.id} · {t.point.name}
              <span className="block text-sm text-zinc-500">
                {t.acceptedAt && formatDateTime(t.acceptedAt)}
              </span>
            </Link>
          ))}
        </section>
      )}
    </MobileShell>
  );
}
