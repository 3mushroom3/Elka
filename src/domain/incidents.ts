import { type Incident, type IncidentType, LocationType, MovementType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { formatMoney, INCIDENT_LABEL } from "@/lib/labels";
import { postMovement, systemLocationId } from "./ledger";
import { notifyManagers } from "./notify";

export async function createIncident(
  tx: Tx,
  data: {
    type: IncidentType;
    description: string;
    pointId?: number | null;
    userId?: number | null;
    secondUserId?: number | null;
    productId?: number | null;
    qty?: number;
    amount?: number;
    tripId?: number | null;
    shiftId?: number | null;
    saleId?: number | null;
  },
) {
  const incident = await tx.incident.create({ data });
  // Любой инцидент сразу уходит менеджеру
  const size = data.amount
    ? ` (${formatMoney(data.amount)})`
    : data.qty
      ? ` (${data.qty > 0 ? "+" : ""}${data.qty} шт.)`
      : "";
  await notifyManagers(tx, {
    type: data.type,
    title: `${INCIDENT_LABEL[data.type]}${size}`,
    body: data.description,
    link: "/manager/incidents",
  });
  return incident;
}

// Что менеджер может сделать с инцидентом одним действием.
//   CHARGE              - записать на сотрудника
//   DISMISS             - закрыть без последствий
//   RETURN_TO_POINT     - товар на самом деле на точке (ошибка пересчёта или приёма)
//   RETURN_TO_WAREHOUSE - водитель вернул товар на склад
//   WRITE_OFF           - списать (не записывая на сотрудника)
export type IncidentAction =
  | "CHARGE"
  | "DISMISS"
  | "RETURN_TO_POINT"
  | "RETURN_TO_WAREHOUSE"
  | "WRITE_OFF";

const POINT_SHORTAGE: IncidentType[] = ["DAY_SHORTAGE", "NIGHT_SHORTAGE"];
const POINT_SURPLUS: IncidentType[] = ["DAY_SURPLUS", "NIGHT_SURPLUS"];

export function allowedActions(incident: Pick<Incident, "type" | "qty">): IncidentAction[] {
  if (POINT_SHORTAGE.includes(incident.type)) {
    return ["CHARGE", "RETURN_TO_POINT", "WRITE_OFF"];
  }
  if (POINT_SURPLUS.includes(incident.type)) return ["DISMISS", "RETURN_TO_POINT"];
  // Продавец принял меньше, чем выгрузил водитель: разница числится на водителе
  if (incident.type === "DELIVERY_MISMATCH" && incident.qty < 0) {
    return ["CHARGE", "RETURN_TO_WAREHOUSE", "RETURN_TO_POINT"];
  }
  return ["CHARGE", "DISMISS"];
}

// Разбор инцидента: решение менеджера и, если нужно, проводка в журнале движений.
// Инцидент нельзя удалить, можно только закрыть с письменным решением.
export async function resolveIncident(
  tx: Tx,
  managerId: number,
  input: {
    incidentId: number;
    action: IncidentAction;
    resolution: string;
    // на кого записать (по умолчанию ответственный из инцидента)
    chargedUserId?: number | null;
  },
) {
  const text = input.resolution.trim();
  if (!text) throw new DomainError("Опишите, чем закончился разбор");
  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM incidents WHERE id = ${input.incidentId} FOR UPDATE`;
  if (locked.length === 0) throw new DomainError("Инцидент не найден");
  const incident = await tx.incident.findUniqueOrThrow({ where: { id: input.incidentId } });
  if (incident.status !== "OPEN") throw new DomainError("Инцидент уже закрыт");
  if (!allowedActions(incident).includes(input.action)) {
    throw new DomainError("Это действие не подходит для такого инцидента");
  }

  let chargedUserId: number | null = null;
  if (input.action === "CHARGE") {
    chargedUserId = input.chargedUserId ?? incident.userId ?? incident.secondUserId;
    const parties = [incident.userId, incident.secondUserId];
    if (chargedUserId === null || !parties.includes(chargedUserId)) {
      throw new DomainError("Выберите, на кого записать: на одного из участников инцидента");
    }
  }

  // Проводка, если решение меняет место, где числится товар
  const qty = Math.abs(incident.qty);
  const move = async (from: number, to: number) => {
    if (!incident.productId || qty === 0) return;
    await postMovement(tx, {
      type: MovementType.CORRECTION,
      productId: incident.productId,
      qty,
      fromLocationId: from,
      toLocationId: to,
      authorId: managerId,
      incidentId: incident.id,
      reason: `Инцидент №${incident.id}: ${text}`,
    });
  };
  const system = (type: LocationType) => systemLocationId(tx, type);
  const pointLoc = async () =>
    (await tx.location.findUniqueOrThrow({ where: { pointId: incident.pointId! } })).id;
  const driverLoc = async () =>
    (await tx.location.findUniqueOrThrow({ where: { driverId: incident.userId! } })).id;

  if (POINT_SHORTAGE.includes(incident.type)) {
    // Пропавшее уже числится в «Недостаче»: при CHARGE там и остаётся
    if (input.action === "RETURN_TO_POINT") {
      await move(await system(LocationType.SHORTAGE), await pointLoc());
    } else if (input.action === "WRITE_OFF") {
      await move(await system(LocationType.SHORTAGE), await system(LocationType.WRITTEN_OFF));
    }
  } else if (POINT_SURPLUS.includes(incident.type)) {
    // Излишек уже проведён на точку: возврат убирает его обратно
    if (input.action === "RETURN_TO_POINT") {
      await move(await pointLoc(), await system(LocationType.SHORTAGE));
    }
  } else if (incident.type === "DELIVERY_MISMATCH" && incident.qty < 0) {
    if (input.action === "CHARGE") {
      await move(await driverLoc(), await system(LocationType.SHORTAGE));
    } else if (input.action === "RETURN_TO_WAREHOUSE") {
      await move(await driverLoc(), await system(LocationType.WAREHOUSE));
    } else if (input.action === "RETURN_TO_POINT") {
      await move(await driverLoc(), await pointLoc());
    }
  }

  await tx.incident.update({
    where: { id: incident.id },
    data: {
      status: "RESOLVED",
      outcome: input.action === "CHARGE" ? "CHARGED" : "NOT_CHARGED",
      chargedUserId,
      resolution: text,
      resolvedById: managerId,
      resolvedAt: new Date(),
    },
  });
  await audit(tx, managerId, "incident.resolve", "incident", incident.id, {
    action: input.action,
    chargedUserId,
    resolution: text,
  });
}
