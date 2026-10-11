import type { Point } from "@prisma/client";
import { PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createPointAction, updatePointAction } from "../actions";

function PointFields({ point }: { point?: Point }) {
  return (
    <>
      <label className="label">Название</label>
      <input
        name="name"
        defaultValue={point?.name}
        className="input mb-3"
        required
      />
      <label className="label">Адрес</label>
      <input
        name="address"
        defaultValue={point?.address}
        className="input mb-3"
      />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Открыть смену до</label>
          <input
            name="openDeadline"
            type="time"
            defaultValue={point?.openDeadline ?? "10:00"}
            className="input"
            required
          />
        </div>
        <div>
          <label className="label">Закрыть смену до</label>
          <input
            name="closeDeadline"
            type="time"
            defaultValue={point?.closeDeadline ?? "22:00"}
            className="input"
            required
          />
        </div>
        <div>
          <label className="label">Низкий остаток, шт.</label>
          <input
            name="lowStockThreshold"
            type="number"
            min={0}
            defaultValue={point?.lowStockThreshold ?? 10}
            className="input"
            required
          />
        </div>
      </div>
    </>
  );
}

export default async function PointsPage() {
  await requireRole("MANAGER");
  const points = await prisma.point.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { sellers: { include: { user: { select: { fullName: true } } } } },
  });

  return (
    <>
      <PageHeader
        title="Точки"
        hint="Места продаж: к какому времени открыть и закрыть смену и когда считать, что товара мало."
      />

      <div className="mb-6 flex flex-col gap-3">
        {points.length === 0 && (
          <p className="text-sm text-zinc-500">Точек пока нет.</p>
        )}
        {points.map((p) => (
          <details key={p.id} className="card">
            <summary className="cursor-pointer">
              <span className="font-semibold">{p.name}</span>
              {!p.isActive && (
                <span className="ml-2 text-sm text-red-600">закрыта</span>
              )}
              <span className="ml-2 text-sm text-zinc-500">
                {p.address}
                {p.sellers.length > 0 &&
                  ` · продавцы: ${p.sellers.map((s) => s.user.fullName).join(", ")}`}
              </span>
            </summary>
            <ActionForm
              action={updatePointAction}
              submitLabel="Сохранить"
              className="mt-4"
            >
              <input type="hidden" name="id" value={p.id} />
              <PointFields point={p} />
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={p.isActive}
                />
                Точка работает
              </label>
            </ActionForm>
          </details>
        ))}
      </div>

      <section className="card max-w-xl">
        <h2 className="h2">Новая точка</h2>
        <ActionForm
          action={createPointAction}
          submitLabel="Создать точку"
          resetOnSuccess
        >
          <PointFields />
        </ActionForm>
      </section>
    </>
  );
}
