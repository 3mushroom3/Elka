import type { Incident } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { allowedActions, type IncidentAction } from "@/domain/incidents";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatMoney, INCIDENT_LABEL } from "@/lib/labels";
import { resolveIncidentAction } from "../actions";

// Подписи действий зависят от вида инцидента: одно и то же действие
// для недостачи на точке и для расхождения при приёме значит разное.
function actionLabel(incident: Incident, action: IncidentAction) {
  const delivery = incident.type === "DELIVERY_MISMATCH";
  const surplus = incident.type === "DAY_SURPLUS" || incident.type === "NIGHT_SURPLUS";
  switch (action) {
    case "CHARGE":
      return delivery && incident.qty < 0
        ? "Записать недостачу на водителя (товар снимается с водителя)"
        : "Записать на сотрудника";
    case "DISMISS":
      return "Закрыть без последствий";
    case "RETURN_TO_POINT":
      return delivery
        ? "Товар на точке: продавец ошибся при приёме (перенести на точку)"
        : surplus
          ? "Ошибка пересчёта: излишка нет (убрать с учёта точки)"
          : "Товар нашёлся или ошибка пересчёта (вернуть на учёт точки)";
    case "RETURN_TO_WAREHOUSE":
      return "Водитель вернул товар на склад (перенести на склад)";
    case "WRITE_OFF":
      return "Списать, на сотрудника не записывать";
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
    prisma.incident.findMany({ where: { status: "OPEN" }, orderBy: { id: "desc" }, include }),
    prisma.incident.findMany({
      where: { status: "RESOLVED" },
      orderBy: { resolvedAt: "desc" },
      take: 50,
      include,
    }),
  ]);

  return (
    <>
      <h1 className="h1">Инциденты</h1>

      {open.length === 0 && (
        <p className="card mb-6 text-sm text-zinc-500">Открытых инцидентов нет.</p>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {open.map((i) => {
          const actions = allowedActions(i);
          const parties = [i.user, i.secondUser].filter((u) => u !== null);
          return (
            <section key={i.id} className="card border-l-8 border-l-red-500">
              <p className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold">{INCIDENT_LABEL[i.type]}</span>
                {/* Денежные инциденты показывают сумму, остальные - количество стволов */}
                {i.amount !== 0 ? (
                  <span className="text-xl font-bold whitespace-nowrap text-red-600 tabular-nums">
                    {formatMoney(i.amount)}
                  </span>
                ) : (
                  i.qty !== 0 && (
                    <span className="text-xl font-bold whitespace-nowrap text-red-600 tabular-nums">
                      {i.qty > 0 ? `+${i.qty}` : i.qty} шт.
                    </span>
                  )
                )}
              </p>
              <p className="text-sm text-zinc-500">
                №{i.id} · {formatDateTime(i.createdAt)}
                {i.point && ` · ${i.point.name}`}
                {i.tripId && ` · рейс №${i.tripId}`}
                {i.shiftId && ` · смена №${i.shiftId}`}
              </p>
              <p className="mt-2">{i.description}</p>
              <p className="text-sm text-zinc-600">
                {i.type === "NIGHT_SHORTAGE" || i.type === "NIGHT_SURPLUS"
                  ? `Сдал точку: ${i.user?.fullName ?? "—"} · принял: ${i.secondUser?.fullName ?? "—"}`
                  : [
                      i.user && `Ответственный: ${i.user.fullName}`,
                      i.secondUser && `вторая сторона: ${i.secondUser.fullName}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
              <ActionForm
                action={resolveIncidentAction}
                submitLabel="Закрыть инцидент"
                confirm="Закрыть инцидент с этим решением? Изменить его после этого нельзя."
              >
                <input type="hidden" name="incidentId" value={i.id} />
                <label className="label mt-3">Что делаем</label>
                <select name="action" className="input" required defaultValue="">
                  <option value="" disabled>
                    Выберите решение
                  </option>
                  {actions.map((a) => (
                    <option key={a} value={a}>
                      {actionLabel(i, a)}
                    </option>
                  ))}
                </select>
                {actions.includes("CHARGE") && parties.length > 1 && (
                  <>
                    <label className="label mt-3">На кого записать (если записываем)</label>
                    <select name="chargedUserId" className="input" defaultValue={parties[0].id}>
                      {parties.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label className="label mt-3">Что выяснили</label>
                <input name="resolution" className="input" required />
              </ActionForm>
            </section>
          );
        })}
      </div>

      <section className="card overflow-x-auto">
        <h2 className="h2">Закрытые</h2>
        {resolved.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Что произошло</th>
                <th className="num">Кол-во / сумма</th>
                <th>Итог</th>
                <th>Решение</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td className="whitespace-nowrap">{formatDateTime(i.createdAt)}</td>
                  <td>
                    {INCIDENT_LABEL[i.type]}
                    <span className="block text-zinc-500">{i.description}</span>
                  </td>
                  <td className="num whitespace-nowrap">
                    {i.amount !== 0 ? formatMoney(i.amount) : i.qty}
                  </td>
                  <td>
                    {i.outcome === "CHARGED" ? (
                      <span className="font-semibold text-red-600">
                        Записано: {i.chargedUser?.fullName}
                      </span>
                    ) : (
                      "Не записано"
                    )}
                  </td>
                  <td>
                    {i.resolution}
                    <span className="block text-zinc-500">
                      {i.resolvedBy?.fullName}
                      {i.resolvedAt && ` · ${formatDateTime(i.resolvedAt)}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-sm text-zinc-500">
          Решения, которые переносят товар, сразу проводятся в журнале движений со ссылкой на
          инцидент.
        </p>
      </section>
    </>
  );
}
