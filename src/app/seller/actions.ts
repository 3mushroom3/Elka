"use server";

import type { PaymentMethod, WriteoffReason } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acceptDelivery, createRequest } from "@/domain/delivery";
import { DomainError } from "@/domain/errors";
import { recordSale, requestSaleCancel } from "@/domain/sales";
import { closeShift, eveningCount, openShift } from "@/domain/shift";
import { createWriteoff } from "@/domain/writeoff";
import { intField, qtyLines, roleAction, strField } from "@/lib/action";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { flushTelegram } from "@/lib/telegram";
import { discardImage, saveImage } from "@/lib/uploads";

function refresh() {
  revalidatePath("/seller", "layout");
}

export const createRequestAction = roleAction("SELLER", async (user, form) => {
  await prisma.$transaction((tx) =>
    createRequest(tx, user.id, {
      pointId: intField(form, "pointId"),
      items: qtyLines(form, "qty_", false),
      comment: strField(form, "comment"),
    }),
  );
  refresh();
  redirect("/seller");
});

export const acceptDeliveryAction = roleAction("SELLER", async (user, form) => {
  await prisma.$transaction((tx) =>
    acceptDelivery(tx, user.id, intField(form, "tripId"), qtyLines(form, "qty_", true)),
  );
  refresh();
  redirect("/seller");
});

export const openShiftAction = roleAction("SELLER", async (user, form) => {
  await prisma.$transaction((tx) =>
    openShift(tx, user.id, {
      pointId: intField(form, "pointId"),
      actual: qtyLines(form, "qty_", true),
    }),
  );
  refresh();
  redirect("/seller");
});

export const eveningCountAction = roleAction("SELLER", async (user, form) => {
  await prisma.$transaction((tx) => eveningCount(tx, user.id, qtyLines(form, "qty_", true)));
  refresh();
  redirect("/seller/cash");
});

export const closeShiftAction = roleAction("SELLER", async (user, form) => {
  if (strField(form, "cash") === "") throw new DomainError("Введите сумму наличных");
  await prisma.$transaction((tx) => closeShift(tx, user.id, intField(form, "cash")));
  refresh();
  redirect("/seller");
});

export const requestCancelAction = roleAction("SELLER", async (user, form) => {
  await prisma.$transaction((tx) =>
    requestSaleCancel(tx, user.id, intField(form, "saleId"), strField(form, "reason")),
  );
  refresh();
  return "Запрос отправлен менеджеру";
});

const PAYMENTS: PaymentMethod[] = ["CASH", "TRANSFER", "CARD"];

// Продажа вызывается с экрана продажи напрямую, без формы.
export async function recordSaleAction(input: {
  productId: number;
  qty: number;
  stickerPrice: number;
  price: number;
  discountReason: string;
  payment: PaymentMethod;
  clientKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "SELLER") return { ok: false, error: "Нет доступа. Войдите заново." };
  if (!PAYMENTS.includes(input.payment)) return { ok: false, error: "Выберите способ оплаты" };
  try {
    await prisma.$transaction((tx) =>
      recordSale(tx, user.id, {
        productId: Number(input.productId),
        qty: Number(input.qty),
        stickerPrice: Number(input.stickerPrice),
        price: Number(input.price),
        discountReason: String(input.discountReason ?? ""),
        payment: input.payment,
        clientKey: String(input.clientKey).slice(0, 64),
      }),
    );
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
  refresh();
  void flushTelegram().catch(() => {});
  return { ok: true };
}

const WRITEOFF_REASONS: WriteoffReason[] = ["DEFECT", "BROKEN", "THEFT", "OTHER"];

export const createWriteoffAction = roleAction("SELLER", async (user, form) => {
  const reason = strField(form, "reason") as WriteoffReason;
  if (!WRITEOFF_REASONS.includes(reason)) throw new DomainError("Выберите причину");
  const photo = await saveImage(form.get("photo"), user.id);
  try {
    await prisma.$transaction((tx) =>
      createWriteoff(tx, user.id, {
        productId: intField(form, "productId"),
        qty: intField(form, "qty"),
        reason,
        comment: strField(form, "comment"),
        photoId: photo.id,
      }),
    );
  } catch (e) {
    // Запрос не сохранился: фото без запроса не оставляем
    await discardImage(photo.id);
    throw e;
  }
  refresh();
  redirect("/seller");
});
