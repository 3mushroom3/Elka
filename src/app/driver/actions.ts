"use server";

import { revalidatePath } from "next/cache";
import { confirmLoad, confirmUnload, depart } from "@/domain/delivery";
import { intField, qtyLines, roleAction } from "@/lib/action";
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
