"use server";

import { redirect } from "next/navigation";
import { audit } from "@/domain/audit";
import { verifyPassword } from "@/domain/password";
import type { ActionState } from "@/lib/action-types";
import { createSession, destroySession, getCurrentUser, homePath } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function login(_prev: ActionState, form: FormData): Promise<ActionState> {
  const loginName = String(form.get("login") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const user = await prisma.user.findUnique({ where: { login: loginName } });
  const valid = user?.isActive && (await verifyPassword(password, user.passwordHash));
  if (!user || !valid) {
    await audit(prisma, user?.id ?? null, "login.failed", "user", user?.id ?? null, {
      login: loginName.slice(0, 64),
    });
    // Пауза затрудняет подбор пароля
    await new Promise((r) => setTimeout(r, 700));
    return { error: "Неверный логин или пароль" };
  }

  await createSession(user.id);
  await audit(prisma, user.id, "login", "user", user.id);
  redirect(homePath(user.role));
}

export async function logout() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) await audit(prisma, user.id, "logout", "user", user.id);
  redirect("/login");
}
