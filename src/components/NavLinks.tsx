"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active =
          item.href === "/manager" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap ${
              active ? "bg-emerald-700 text-white" : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {item.label}
            {item.badge ? (
              <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}
