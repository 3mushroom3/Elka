"use server";

import { revalidatePath } from "next/cache";
import { confirmLoad, confirmUnload, depart } from "@/domain/delivery";
import { intField, qtyLines, roleAction } from "@/lib/action";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

function refresh() {
  revalidatePath("/driver", "layout");
}

export const confirmLoadAction = roleAction("DRIVER", async (user, form) => {
  await prisma.$transaction((tx) =>
    confirmLoad(tx, user.id, intField(form, "tripId"), qtyLines(form, "qty_", true)),
  );
  refresh();
  return "Загрузка подтверждена";
});

export const departAction = roleAction("DRIVER", async (user, form) => {
  await prisma.$transaction((tx) => depart(tx, user.id, intField(form, "tripId")));
  refresh();
  return "В пути";
});

export const confirmUnloadAction = roleAction("DRIVER", async (user, form) => {
  await prisma.$transaction((tx) =>
    confirmUnload(tx, user.id, intField(form, "tripId"), qtyLines(form, "qty_", true)),
  );
  refresh();
  return "Выгрузка отмечена";
});

// Точка трека рейса. Телефон водителя шлёт её, пока рейс в работе и водитель
// разрешил геолокацию; выключить можно на экране рейса.
export async function reportTripLocation(input: {
  tripId: number;
  latitude: number;
  longitude: number;
  accuracyM?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "DRIVER") return { ok: false, error: "Нет доступа" };
  if (!Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90) {
    return { ok: false, error: "Неверная широта" };
  }
  if (!Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180) {
    return { ok: false, error: "Неверная долгота" };
  }
  // Писать можно только в свой рейс и только пока он не завершён
  const trip = await prisma.trip.findFirst({
    where: {
      id: input.tripId,
      driverId: user.id,
      status: { in: ["ASSIGNED", "LOADED", "IN_TRANSIT", "DELIVERED"] },
    },
    select: { id: true },
  });
  if (!trip) return { ok: false, error: "Рейс не найден или уже завершён" };

  await prisma.tripLocation.create({
    data: {
      tripId: trip.id,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyM:
        input.accuracyM !== undefined && Number.isFinite(input.accuracyM)
          ? Math.round(input.accuracyM)
          : null,
    },
  });
  return { ok: true };
}
