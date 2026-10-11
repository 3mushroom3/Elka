import { AutoRefresh } from "@/components/AutoRefresh";
import { ManagerNav } from "@/components/ManagerNav";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logout } from "../auth-actions";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("MANAGER");
  const [requests, incidents, sales, writeoffs, notifications] = await Promise.all([
    prisma.deliveryRequest.count({ where: { status: "NEW" } }),
    prisma.incident.count({ where: { status: "OPEN" } }),
    prisma.sale.count({ where: { cancelStatus: "REQUESTED" } }),
    prisma.writeoffRequest.count({ where: { status: "PENDING" } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <div className="lg:flex">
      <ManagerNav
        userName={user.fullName}
        badges={{ requests, incidents, sales, writeoffs, notifications }}
        logout={logout}
      />
      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      <AutoRefresh />
    </div>
  );
}
