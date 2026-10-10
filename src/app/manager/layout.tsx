import { AutoRefresh } from "@/components/AutoRefresh";
import { NavLinks } from "@/components/NavLinks";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logout } from "../auth-actions";


export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("MANAGER");
  const [newRequests, openIncidents, cancelRequests, pendingWriteoffs, unread] = await Promise.all([
    prisma.deliveryRequest.count({ where: { status: "NEW" } }),
    prisma.incident.count({ where: { status: "OPEN" } }),
    prisma.sale.count({ where: { cancelStatus: "REQUESTED" } }),
    prisma.writeoffRequest.count({ where: { status: "PENDING" } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  const nav = [
    { href: "/manager", label: "Панель" },
    { href: "/manager/notifications", label: "Уведомления", badge: unread },
    { href: "/manager/sales", label: "Продажи", badge: cancelRequests },
    { href: "/manager/shifts", label: "Смены и пересчёты" },
    { href: "/manager/requests", label: "Заявки", badge: newRequests },
    { href: "/manager/deliveries", label: "Доставка" },
    { href: "/manager/writeoffs", label: "Списания", badge: pendingWriteoffs },
    { href: "/manager/incidents", label: "Инциденты", badge: openIncidents },
    { href: "/manager/shortages", label: "Недостачи" },
    { href: "/manager/reports", label: "Отчёты" },
    { href: "/manager/warehouse", label: "Склад" },
    { href: "/manager/movements", label: "Журнал движений" },
    { href: "/manager/points", label: "Точки" },
    { href: "/manager/staff", label: "Сотрудники" },
    { href: "/manager/products", label: "Виды товара" },
    { href: "/manager/audit", label: "Журнал действий" },
  ];

  return (
    <div className="mx-auto max-w-6xl md:flex md:gap-6 md:p-6">
      <aside className="border-b border-zinc-200 bg-white md:w-56 md:shrink-0 md:self-start md:rounded-xl md:border md:p-3">
        <div className="flex items-center justify-between px-4 pt-3 md:block md:px-1 md:pt-0">
          <p className="text-lg font-bold text-emerald-800">Ёлка: учёт</p>
          <p className="text-sm text-zinc-500 md:mb-3">{user.fullName}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:px-0">
          <NavLinks items={nav} />
          <form action={logout} className="md:mt-3">
            <button className="rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-zinc-500 hover:bg-zinc-100">
              Выйти
            </button>
          </form>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-0">{children}</main>
      <AutoRefresh />
    </div>
  );
}
