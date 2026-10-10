import type { Incident } from "@prisma/client";

export type ShortageRow = {
  userId: number;
  // стволы: недостача на разборе и уже записанная на сотрудника
  stemsOpen: number;
  stemsCharged: number;
  // деньги: недостача наличных на разборе и записанная
  cashOpen: number;
  cashCharged: number;
  // сумма скидок ниже стикера (для сведения)
  discounts: number;
  // сколько инцидентов закрыто без записи на сотрудника
  dismissed: number;
};

type IncidentLike = Pick<
  Incident,
  "type" | "status" | "outcome" | "userId" | "secondUserId" | "chargedUserId" | "qty" | "amount"
>;

const STEM_TYPES = ["DAY_SHORTAGE", "NIGHT_SHORTAGE", "DELIVERY_MISMATCH"];

// Накопленная недостача по сотрудникам.
// Открытый инцидент числится «на разборе» за ответственным из инцидента,
// закрытый - за тем, на кого его записал менеджер. Снятые не учитываются.
export function summarizeShortages(incidents: IncidentLike[]): ShortageRow[] {
  const rows = new Map<number, ShortageRow>();
  const row = (userId: number) => {
    if (!rows.has(userId)) {
      rows.set(userId, {
        userId,
        stemsOpen: 0,
        stemsCharged: 0,
        cashOpen: 0,
        cashCharged: 0,
        discounts: 0,
        dismissed: 0,
      });
    }
    return rows.get(userId)!;
  };

  for (const i of incidents) {
    const open = i.status === "OPEN";
    const owner = open ? (i.userId ?? i.secondUserId) : i.chargedUserId;

    if (i.type === "DISCOUNT") {
      if (i.userId !== null) row(i.userId).discounts += -i.amount;
      continue;
    }
    if (!open && i.outcome !== "CHARGED") {
      const responsible = i.userId ?? i.secondUserId;
      if (responsible !== null) row(responsible).dismissed += 1;
      continue;
    }
    if (owner === null) continue;

    if (STEM_TYPES.includes(i.type) && i.qty < 0) {
      if (open) row(owner).stemsOpen += -i.qty;
      else row(owner).stemsCharged += -i.qty;
    } else if (i.type === "CASH_MISMATCH" && i.amount < 0) {
      if (open) row(owner).cashOpen += -i.amount;
      else row(owner).cashCharged += -i.amount;
    }
  }
  return [...rows.values()];
}
