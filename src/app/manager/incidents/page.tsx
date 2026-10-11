import type { Incident } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { Chip, Empty, PageHeader } from "@/components/ui";
import { allowedActions, type IncidentAction } from "@/domain/incidents";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatMoney, INCIDENT_LABEL } from "@/lib/labels";
import { resolveIncidentAction } from "../actions";

// Решение простыми словами: что нажать и что после этого произойдёт.
// Одно и то же действие для разных инцидентов значит разное.
function describeAction(
  incident: Incident,
  action: IncidentAction,
): [string, string] {
  const delivery = incident.type === "DELIVERY_MISMATCH";
  const surplus =
    incident.type === "DAY_SURPLUS" || incident.type === "NIGHT_SURPLUS";
  switch (action) {
    case "CHARGE":
      return delivery && incident.qty < 0
        ? [
            "Записать на водителя",
            "Товар снимается с водителя и остаётся за ним как недостача",
          ]
        : ["Записать на сотрудника", "Останется в его недостаче за сезон"];
    case "DISMISS":
      return [
        "Закрыть без последствий",
        "Ни на кого не записывается, остатки не меняются",
      ];
    case "RETURN_TO_POINT":
      if (delivery)
        return [
          "Товар на точке",
          "Продавец ошибся при приёме: перенести на точку",
        ];
      if (surplus)
        return ["Излишка нет", "Ошибка пересчёта: убрать лишнее с учёта точки"];
      return ["Товар нашёлся", "Ошибка пересчёта: вернуть на учёт точки"];
    case "RETURN_TO_WAREHOUSE":
      return [
        "Вернул на склад",
        "Водитель привёз товар обратно: перенести на склад",
      ];
    case "WRITE_OFF":
      return ["Списать", "Товар потерян не по вине сотрудника"];
  }
}

export default async function IncidentsPage() {
  await requireRole("MANAGER");
  const include = {
    point: { select: { name: true } },
    user: { select: { id: true, fullName: true } },
    secondUser: { select: { id: true, fullName: true } },
    chargedUser: { select: { fullName: true } },
    resolvedBy: { select: { fullName: true } },
  } as const;
  const [open, resolved] = await Promise.all([
    prisma.incident.findMany({
      where: { status: "OPEN" },
      orderBy: { id: "desc" },
      include,
    }),
    prisma.incident.findMany({
      where: { status: "RESOLVED" },
      orderBy: { resolvedAt: "desc" },
      take: 50,
      include,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Инциденты"
        hint="Всё, что не сошлось: недостачи, расхождения при приёме и по деньгам, скидки, не открытые вовремя смены. Выберите решение, нужные записи система сделает сама."
      />

      {open.length === 0 && (
        <div className="mb-6">
          <Empty>Неразобранных инцидентов нет.</Empty>
        </div>
      )}
      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        {open.map((i) => {
          const actions = allowedActions(i);
          const parties = [i.user, i.secondUser].filter((u) => u !== null);
          const night =
            i.type === "NIGHT_SHORTAGE" || i.type === "NIGHT_SURPLUS";
          return (
            <section key={i.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">
                    {INCIDENT_LABEL[i.type]}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {formatDateTime(i.createdAt)}
                    {i.point && ` · ${i.point.name}`}
                    {i.tripId && ` · рейс №${i.tripId}`}
                    {i.shiftId && ` · смена №${i.shiftId}`}
                  </p>
                </div>
                {/* Денежные инциденты показывают сумму, остальные - количество */}
                {i.amount !== 0 ? (
                  <Chip tone="red">{formatMoney(i.amount)}</Chip>
                ) : (
                  i.qty !== 0 && (
                    <Chip tone={i.qty < 0 ? "red" : "amber"}>
                      {i.qty > 0 ? `+${i.qty}` : i.qty} шт.
                    </Chip>
                  )
                )}
              </div>
              <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2">
                {i.description}
              </p>
              {parties.length > 0 && (
                <p className="mt-2 text-sm text-zinc-600">
                  {night
                    ? `Сдал точку вечером: ${i.user?.fullName ?? "—"} · принял утром: ${i.secondUser?.fullName ?? "—"}`
                    : [
                        i.user && `Ответственный: ${i.user.fullName}`,
                        i.secondUser &&
                          `вторая сторона: ${i.secondUser.fullName}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
              )}

              <ActionForm
                action={resolveIncidentAction}
                submitLabel="Закрыть с этим решением"
                confirm="Закрыть инцидент с этим решением? Изменить его после этого нельзя."
              >
                <input type="hidden" name="incidentId" value={i.id} />
                <p className="label mt-4">Что делаем</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {actions.map((a) => {
                    const [title, detail] = describeAction(i, a);
                    return (
                      <label
                        key={a}
                        className="flex cursor-pointer gap-2 rounded-xl border border-zinc-300 p-3 transition hover:bg-zinc-50 has-checked:border-emerald-600 has-checked:bg-emerald-50"
                      >
                        <input
                          type="radio"
                          name="action"
                          value={a}
                          required
                          className="mt-1 accent-emerald-700"
                        />
                        <span>
                          <span className="block font-semibold">{title}</span>
                          <span className="block text-sm text-zinc-500">
                            {detail}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {actions.includes("CHARGE") && parties.length > 1 && (
                  <>
                    <label className="label mt-3">
                      Если записываем, то на кого
                    </label>
                    <select
                      name="chargedUserId"
                      className="input"
                      defaultValue={parties[0].id}
                    >
                      {parties.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label className="label mt-3">
                  Что выяснили (останется в истории)
                </label>
                <input name="resolution" className="input" required />
              </ActionForm>
            </section>
          );
        })}
      </div>

      <section className="card overflow-x-auto">
        <h2 className="h2">Разобранные</h2>
        {resolved.length === 0 ? (
          <Empty>Пока ничего не разобрано.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Что произошло</th>
                <th className="num">Сколько</th>
                <th>Итог</th>
                <th>Решение</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap">
                    {formatDateTime(i.createdAt)}
                  </td>
                  <td>
                    <span className="font-medium">
                      {INCIDENT_LABEL[i.type]}
                    </span>
                    <span className="block text-sm text-zinc-500">
                      {i.description}
                    </span>
                  </td>
                  <td className="num whitespace-nowrap">
                    {i.amount !== 0
                      ? formatMoney(i.amount)
                      : i.qty !== 0
                        ? `${i.qty} шт.`
                        : ""}
                  </td>
                  <td>
                    {i.outcome === "CHARGED" ? (
                      <Chip tone="red">
                        Записано: {i.chargedUser?.fullName}
                      </Chip>
                    ) : (
                      <Chip tone="gray">Не записано</Chip>
                    )}
                  </td>
                  <td>
                    {i.resolution}
                    <span className="block text-sm text-zinc-500">
                      {i.resolvedBy?.fullName}
                      {i.resolvedAt && ` · ${formatDateTime(i.resolvedAt)}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
