import { redirect } from "next/navigation";
import { MobileShell } from "@/components/MobileShell";
import { currentShift } from "@/domain/shift";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listProducts } from "@/lib/queries";
import { WriteoffForm } from "./WriteoffForm";

export default async function WriteoffPage() {
  const user = await requireRole("SELLER");
  const shift = await currentShift(prisma, user.id);
  if (shift?.status !== "OPEN") redirect("/seller");
  const products = await listProducts();

  return (
    <MobileShell title="Списание" backHref="/seller">
      <WriteoffForm products={products.map((p) => ({ id: p.id, name: p.name }))} />
    </MobileShell>
  );
}
