import Link from "next/link";
import { logout } from "@/app/auth-actions";

// Общая рамка телефонных экранов продавца и водителя.
export function MobileShell({
  title,
  userName,
  backHref,
  children,
}: {
  title: string;
  userName?: string;
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 bg-emerald-800 px-3 text-white">
        {backHref && (
          <Link
            href={backHref}
            className="-ml-2 flex h-12 w-12 items-center justify-center text-3xl"
            aria-label="Назад"
          >
            ‹
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        {userName && (
          <form action={logout}>
            <button className="rounded-lg px-3 py-2 text-sm text-emerald-100">Выйти</button>
          </form>
        )}
      </header>
      {userName && <p className="px-4 pt-3 text-sm text-zinc-500">{userName}</p>}
      <main className="flex flex-col gap-4 p-4">{children}</main>
    </div>
  );
}
