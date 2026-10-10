import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

export async function audit(
  tx: Tx,
  userId: number | null,
  action: string,
  entity = "",
  entityId: number | null = null,
  payload?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: { userId, action, entity, entityId, payload },
  });
}
