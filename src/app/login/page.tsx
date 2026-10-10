import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { getCurrentUser, homePath } from "@/lib/auth";
import { login } from "../auth-actions";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePath(user.role));

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-center text-3xl font-bold text-emerald-800">Ёлка: учёт</h1>
      <ActionForm action={login} submitLabel="Войти" className="card flex flex-col">
        <label className="label" htmlFor="login">
          Логин
        </label>
        <input
          id="login"
          name="login"
          className="input"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          required
        />
        <label className="label mt-3" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </ActionForm>
      <p className="mt-4 text-center text-sm text-zinc-500">
        Аккаунт выдаёт менеджер. Забыли пароль: обратитесь к нему.
      </p>
    </main>
  );
}
