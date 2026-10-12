"use server";

import { ProductCategory, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  createPoint,
  createProduct,
  createUser,
  type PointInput,
  type ProductInput,
  updatePoint,
  updateProduct,
  updateUser,
} from "@/domain/catalog";
import { audit } from "@/domain/audit";
import {
  acceptReturn,
  approveRequest,
  cancelTrip,
  createDelivery,
  rejectRequest,
} from "@/domain/delivery";
import { DomainError } from "@/domain/errors";
import { type IncidentAction, resolveIncident } from "@/domain/incidents";
import { postCorrection } from "@/domain/ledger";
import { decideSaleCancel } from "@/domain/sales";
import { confirmShiftCheck } from "@/domain/shift";
import { decideWriteoff } from "@/domain/writeoff";
import { createReceipt, warehouseInventory } from "@/domain/warehouse";
import { intField, qtyLines, roleAction, strField } from "@/lib/action";
import { prisma } from "@/lib/db";
import { sendTelegram, telegramConfigured } from "@/lib/telegram";

function refresh() {
  revalidatePath("/manager", "layout");
}

function idList(form: FormData, name: string) {
  return form.getAll(name).map(Number).filter(Number.isInteger);
}

// Координата: пустое поле значит «не задана». Запятая как разделитель тоже
// принимается: на телефоне её ставят чаще точки.
function floatField(form: FormData, name: string) {
  const raw = strField(form, name).replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new DomainError("Координаты указываются числом");
  return n;
}

function enumField<T extends string>(form: FormData, name: string, values: Record<string, T>) {
  const raw = strField(form, name);
  if (!(raw in values)) throw new DomainError("Недопустимое значение поля");
  return raw as T;
}

// ---------- Склад ----------

export const receiptAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    createReceipt(tx, {
      authorId: user.id,
      supplier: strField(form, "supplier"),
      comment: strField(form, "comment"),
      items: qtyLines(form, "qty_", false),
    }),
  );
  refresh();
  return "Приход проведён";
});

export const inventoryAction = roleAction("MANAGER", async (user, form) => {
  const diffs = await prisma.$transaction((tx) =>
    warehouseInventory(tx, {
      authorId: user.id,
      reason: strField(form, "reason"),
      actual: qtyLines(form, "actual_", true),
    }),
  );
  refresh();
  return diffs.length === 0
    ? "Расхождений нет"
    : `Проведено корректировок: ${diffs.length}. Они видны в журнале движений.`;
});

export const correctionAction = roleAction("MANAGER", async (user, form) => {
  const kind = enumField(form, "kind", {
    INVENTORY: "INVENTORY",
    RECEIPT_ERROR: "RECEIPT_ERROR",
  } as const);
  await prisma.$transaction(async (tx) => {
    const movement = await postCorrection(tx, {
      locationId: intField(form, "locationId"),
      productId: intField(form, "productId"),
      delta: intField(form, "delta"),
      kind,
      reason: strField(form, "reason"),
      authorId: user.id,
    });
    await audit(tx, user.id, "movement.correction", "movement", movement.id, {
      kind,
      qty: movement.qty,
      reason: movement.reason,
    });
  });
  refresh();
  return "Корректировка проведена";
});

// ---------- Сотрудники ----------

export const createUserAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    createUser(tx, user.id, {
      login: strField(form, "login"),
      fullName: strField(form, "fullName"),
      role: enumField(form, "role", Role),
      password: String(form.get("password") ?? ""),
      pointIds: idList(form, "pointIds"),
    }),
  );
  refresh();
  return "Сотрудник создан";
});

export const updateUserAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    updateUser(tx, user.id, intField(form, "id"), {
      fullName: strField(form, "fullName"),
      isActive: form.get("isActive") === "on",
      pointIds: idList(form, "pointIds"),
      newPassword: String(form.get("newPassword") ?? "") || undefined,
    }),
  );
  refresh();
});

// ---------- Точки ----------

function pointInput(form: FormData, isActive: boolean): PointInput {
  return {
    name: strField(form, "name"),
    address: strField(form, "address"),
    openDeadline: strField(form, "openDeadline"),
    closeDeadline: strField(form, "closeDeadline"),
    lowStockThreshold: intField(form, "lowStockThreshold"),
    latitude: floatField(form, "latitude"),
    longitude: floatField(form, "longitude"),
    isActive,
  };
}

export const createPointAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) => createPoint(tx, user.id, pointInput(form, true)));
  refresh();
  return "Точка создана";
});

export const updatePointAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    updatePoint(tx, user.id, intField(form, "id"), pointInput(form, form.get("isActive") === "on")),
  );
  refresh();
});

// ---------- Виды товара ----------

function productInput(form: FormData, isActive: boolean): ProductInput {
  const prices = strField(form, "quickPrices")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  return {
    name: strField(form, "name"),
    category: enumField(form, "category", ProductCategory),
    commissionPercent: intField(form, "commissionPercent"),
    quickPrices: prices,
    isCountable: form.get("isCountable") === "on",
    sortOrder: intField(form, "sortOrder"),
    isActive,
  };
}

export const createProductAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) => createProduct(tx, user.id, productInput(form, true)));
  refresh();
  return "Вид добавлен";
});

export const updateProductAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    updateProduct(
      tx,
      user.id,
      intField(form, "id"),
      productInput(form, form.get("isActive") === "on"),
    ),
  );
  refresh();
});

// ---------- Заявки и доставка ----------

export const approveRequestAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    approveRequest(tx, user.id, {
      requestId: intField(form, "requestId"),
      driverId: intField(form, "driverId"),
      items: qtyLines(form, "qty_", false),
    }),
  );
  refresh();
  return "Заявка утверждена, рейс назначен";
});

export const rejectRequestAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    rejectRequest(tx, user.id, intField(form, "requestId"), strField(form, "reason")),
  );
  refresh();
  return "Заявка отклонена";
});

export const createDeliveryAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    createDelivery(tx, user.id, {
      pointId: intField(form, "pointId"),
      driverId: intField(form, "driverId"),
      items: qtyLines(form, "qty_", false),
      comment: strField(form, "comment"),
    }),
  );
  refresh();
  return "Рейс назначен";
});

export const cancelTripAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    cancelTrip(tx, user.id, intField(form, "tripId"), strField(form, "reason")),
  );
  refresh();
  return "Рейс отменён";
});

export const acceptReturnAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    acceptReturn(tx, user.id, {
      driverId: intField(form, "driverId"),
      items: qtyLines(form, "qty_", false),
    }),
  );
  refresh();
  return "Возврат принят на склад";
});

export const resolveIncidentAction = roleAction("MANAGER", async (user, form) => {
  await prisma.$transaction((tx) =>
    resolveIncident(tx, user.id, {
      incidentId: intField(form, "incidentId"),
      action: strField(form, "action") as IncidentAction,
      resolution: strField(form, "resolution"),
      chargedUserId: intField(form, "chargedUserId") || null,
    }),
  );
  refresh();
  return "Инцидент закрыт";
});

// ---------- Продажи и смены ----------

export const decideCancelAction = roleAction("MANAGER", async (user, form) => {
  const approve = strField(form, "decision") === "approve";
  await prisma.$transaction((tx) =>
    decideSaleCancel(tx, user.id, {
      saleId: intField(form, "saleId"),
      approve,
      comment: strField(form, "comment"),
    }),
  );
  refresh();
  return approve ? "Продажа отменена, товар возвращён на точку" : "В отмене отказано";
});

export const confirmShiftCheckAction = roleAction("MANAGER", async (user, form) => {
  const what = strField(form, "what") === "stickers" ? "stickers" : "cash";
  await prisma.$transaction((tx) =>
    confirmShiftCheck(tx, user.id, intField(form, "shiftId"), what),
  );
  refresh();
  return "Отмечено";
});

// ---------- Списания ----------

export const decideWriteoffAction = roleAction("MANAGER", async (user, form) => {
  const approve = strField(form, "decision") === "approve";
  await prisma.$transaction((tx) =>
    decideWriteoff(tx, user.id, {
      writeoffId: intField(form, "writeoffId"),
      approve,
      comment: strField(form, "comment"),
    }),
  );
  refresh();
  return approve ? "Списано" : "В списании отказано";
});

// ---------- Уведомления ----------

export const markNotificationsReadAction = roleAction("MANAGER", async (user) => {
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  refresh();
  return "Все уведомления отмечены прочитанными";
});

export const saveTelegramAction = roleAction("MANAGER", async (user, form) => {
  const chatId = strField(form, "chatId");
  if (chatId && !/^-?\d{4,20}$/.test(chatId)) {
    throw new DomainError("ID чата состоит только из цифр. Его показывает бот @userinfobot.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { telegramChatId: chatId || null } });
    await audit(tx, user.id, "user.telegram", "user", user.id, { connected: Boolean(chatId) });
  });
  refresh();
  if (!chatId) return "Telegram отключён";
  if (!telegramConfigured()) {
    return "ID сохранён. Сообщения начнут приходить, когда на сервере будет задан токен бота.";
  }
  const sent = await sendTelegram(chatId, "Ёлка: учёт. Уведомления подключены.");
  if (!sent) {
    throw new DomainError(
      "ID сохранён, но проверочное сообщение не дошло. Откройте бота в Telegram, нажмите «Запустить» и сохраните ещё раз.",
    );
  }
  return "Готово: проверочное сообщение отправлено в Telegram";
});
