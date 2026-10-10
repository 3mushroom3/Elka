import { ActionForm } from "@/components/ActionForm";
import { MobileShell } from "@/components/MobileShell";
import { QtyInput } from "@/components/QtyInput";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listProducts } from "@/lib/queries";
import { createRequestAction } from "../actions";

export default async function RequestPage() {
  const user = await requireRole("SELLER");
  const [points, products] = await Promise.all([
    prisma.point.findMany({
      where: { isActive: true, sellers: { some: { userId: user.id } } },
      orderBy: { name: "asc" },
    }),
    listProducts(),
  ]);

  return (
    <MobileShell title="Заявка на завоз" backHref="/seller">
      {points.length === 0 ? (
        <div className="card">Вам не назначена точка.</div>
      ) : (
        <ActionForm action={createRequestAction} submitLabel="Отправить заявку" wide>
          {points.length === 1 ? (
            <input type="hidden" name="pointId" value={points[0].id} />
          ) : (
            <div className="card mb-4">
              <label className="label">Точка</label>
              <select name="pointId" className="input min-h-14 text-lg" required>
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="card">
            <p className="mb-2 text-sm text-zinc-500">Сколько привезти</p>
            {products.map((p) => (
              <QtyInput key={p.id} name={`qty_${p.id}`} label={p.name} />
            ))}
          </div>
          <div className="card mt-4">
            <label className="label">Комментарий (необязательно)</label>
            <input name="comment" className="input min-h-14" />
          </div>
        </ActionForm>
      )}
    </MobileShell>
  );
}
