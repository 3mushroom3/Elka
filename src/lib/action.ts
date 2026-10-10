import "server-only";
import type { Role } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import type { QtyLine } from "@/domain/warehouse";
import type { ActionState } from "./action-types";
import { type CurrentUser, getCurrentUser } from "./auth";
import { flushTelegram } from "./telegram";

// Обёртка серверного действия: проверяет роль и превращает ошибки
// бизнес-правил в сообщение для формы.
export function roleAction(
  role: Role,
  fn: (user: CurrentUser, form: FormData) => Promise<string | void>,
) {
  return async (_prev: ActionState, form: FormData): Promise<ActionState> => {
    const user = await getCurrentUser();
    if (!user || user.role !== role) return { error: "Нет доступа. Войдите заново." };
    // Действие могло создать уведомления: досылаем их в Telegram, не задерживая ответ.
    // finally срабатывает и при переходе на другую страницу после действия.
    try {
      const ok = await fn(user, form);
      return { ok: ok ?? "Сохранено" };
    } catch (e) {
      if (e instanceof DomainError) return { error: e.message };
      throw e;
    } finally {
      void flushTelegram().catch(() => {});
    }
  };
}

// Целое из поля формы; пустое поле считается нулём.
export function intField(form: FormData, name: string) {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new DomainError("В числовых полях должны быть целые числа");
  return n;
}

export function strField(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

// Поля вида "<prefix><productId>" -> строки с количеством
export function qtyLines(form: FormData, prefix: string, requireAll: boolean): QtyLine[] {
  const lines: QtyLine[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (requireAll && String(value).trim() === "") {
      throw new DomainError("Заполните количество по всем видам");
    }
    lines.push({ productId: Number(key.slice(prefix.length)), qty: intField(form, key) });
  }
  return lines;
}
