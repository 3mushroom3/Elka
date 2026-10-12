import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { CountForm } from "@/components/CountForm";
import { MobileShell } from "@/components/MobileShell";
import { currentShift, productsToCount } from "@/domain/shift";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { openShiftAction } from "../actions";

export default async function OpenShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ point?: string }>;
}) {
  const user = await requireRole("SELLER");
  if (await currentShift(prisma, user.id)) redirect("/seller");

  const points = await prisma.point.findMany({
    where: { isActive: true, sellers: { some: { userId: user.id } } },
    orderBy: { name: "asc" },
    include: { location: true },
  });
  const wanted = Number((await searchParams).point);
  const point = points.find((p) => p.id === wanted) ?? (points.length === 1 ? points[0] : null);

  if (!point) {
    return (
      <MobileShell title="Открыть смену" backHref="/seller">
        {points.length === 0 && <div className="card">Вам не назначена точка.</div>}
        {points.map((p) => (
          <a key={p.id} href={`/seller/open?point=${p.id}`} className="btn min-h-16 text-lg">
            {p.name}
          </a>
        ))}
      </MobileShell>
    );
  }
  // Только названия: учётный остаток продавцу не показывается
  const products = await productsToCount(prisma, point.location!.id);

  return (
    <MobileShell title={`Открыть смену: ${point.name}`} backHref="/seller">
      <div className="card">
        <p className="font-semibold">Утренний пересчёт</p>
        <p className="mt-1 text-sm text-zinc-500">
          Пересчитайте все стволы на точке и введите количество по каждому виду. Если вида нет,
          введите 0. Исправить после подтверждения нельзя.
        </p>
      </div>
      <ActionForm
        action={openShiftAction}
        submitLabel="Открыть смену"
        confirm="Открыть смену с этими цифрами? Изменить их после этого нельзя."
        wide
      >
        <input type="hidden" name="pointId" value={point.id} />
        <CountForm products={products.map((p) => ({ id: p.id, name: p.name }))} />
      </ActionForm>
    </MobileShell>
  );
}
