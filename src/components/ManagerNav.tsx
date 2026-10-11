"use client";

import {
  ArrowLeftRight,
  Bell,
  CalendarCheck,
  ChartColumn,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  MapPin,
  Menu,
  Scale,
  ShoppingBag,
  Trash2,
  TreePine,
  TriangleAlert,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavBadges = Partial<
  Record<"notifications" | "requests" | "writeoffs" | "incidents" | "sales", number>
>;

type Item = { href: string; label: string; icon: LucideIcon; badge?: keyof NavBadges };

// Меню сгруппировано по смыслу: сначала то, что ждёт решения менеджера
const GROUPS: { title?: string; items: Item[] }[] = [
  {
    items: [
      { href: "/manager", label: "Главная", icon: LayoutDashboard },
      { href: "/manager/notifications", label: "Уведомления", icon: Bell, badge: "notifications" },
    ],
  },
  {
    title: "Ждёт вашего решения",
    items: [
      { href: "/manager/requests", label: "Заявки на завоз", icon: ClipboardList, badge: "requests" },
      { href: "/manager/writeoffs", label: "Списания", icon: Trash2, badge: "writeoffs" },
      { href: "/manager/incidents", label: "Инциденты", icon: TriangleAlert, badge: "incidents" },
    ],
  },
  {
    title: "Товар",
    items: [
      { href: "/manager/warehouse", label: "Склад", icon: Warehouse },
      { href: "/manager/deliveries", label: "Доставка", icon: Truck },
      { href: "/manager/movements", label: "Журнал движений", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Продажи и смены",
    items: [
      { href: "/manager/sales", label: "Продажи", icon: ShoppingBag, badge: "sales" },
      { href: "/manager/shifts", label: "Смены и пересчёты", icon: CalendarCheck },
      { href: "/manager/shortages", label: "Недостачи", icon: Scale },
      { href: "/manager/reports", label: "Отчёты", icon: ChartColumn },
    ],
  },
  {
    title: "Настройки",
    items: [
      { href: "/manager/points", label: "Точки", icon: MapPin },
      { href: "/manager/staff", label: "Сотрудники", icon: Users },
      { href: "/manager/products", label: "Виды товара", icon: TreePine },
      { href: "/manager/audit", label: "Журнал действий", icon: History },
    ],
  },
];

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto rounded-full bg-red-600 px-2 py-0.5 text-xs leading-none font-bold text-white">
      {count}
    </span>
  );
}

export function ManagerNav({
  userName,
  badges,
  logout,
}: {
  userName: string;
  badges: NavBadges;
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) =>
    href === "/manager" ? pathname === href : pathname.startsWith(href);
  const total = Object.values(badges).reduce((a, b) => a + (b ?? 0), 0);

  const menu = (
    <nav className="flex flex-col gap-4">
      {GROUPS.map((group, index) => (
        <div key={index}>
          {group.title && (
            <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              {group.title}
            </p>
          )}
          {group.items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition ${
                  active
                    ? "bg-emerald-700 text-white"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                <item.icon size={18} strokeWidth={2} className="shrink-0 opacity-80" />
                {item.label}
                <Badge count={item.badge && badges[item.badge]} />
              </Link>
            );
          })}
        </div>
      ))}
      <form action={logout}>
        <button className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-zinc-500 hover:bg-zinc-100">
          <LogOut size={18} className="shrink-0 opacity-80" />
          Выйти
        </button>
      </form>
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-white">
        <TreePine size={20} />
      </span>
      <div className="leading-tight">
        <p className="font-bold text-emerald-900">Ёлка: учёт</p>
        <p className="text-xs text-zinc-500">{userName}</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Компьютер: постоянная боковая панель */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-zinc-200 bg-white p-4 lg:flex">
        {brand}
        {menu}
      </aside>

      {/* Телефон: верхняя строка и выезжающее меню */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl hover:bg-zinc-100"
          aria-label="Открыть меню"
        >
          <Menu size={24} />
          {total > 0 && (
            <span className="absolute top-1 right-1 h-3 w-3 rounded-full border-2 border-white bg-red-600" />
          )}
        </button>
        <p className="flex min-w-0 flex-1 items-center gap-2 truncate font-bold text-emerald-900">
          <TreePine size={20} className="shrink-0 text-emerald-700" />
          Ёлка: учёт
        </p>
        <Link
          href="/manager/notifications"
          className="relative flex h-11 w-11 items-center justify-center rounded-xl hover:bg-zinc-100"
          aria-label="Уведомления"
        >
          <Bell size={22} />
          {badges.notifications ? (
            <span className="absolute top-0.5 right-0.5 rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
              {badges.notifications}
            </span>
          ) : null}
        </Link>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-zinc-100"
                aria-label="Закрыть меню"
              >
                <X size={22} />
              </button>
            </div>
            {menu}
          </div>
        </div>
      )}
    </>
  );
}
