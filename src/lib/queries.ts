import "server-only";
import { prisma } from "./db";

export function listProducts(onlyActive = true) {
  return prisma.product.findMany({
    where: onlyActive ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

export function listLocations() {
  return prisma.location.findMany({
    include: {
      point: { select: { name: true, isActive: true } },
      driver: { select: { fullName: true, isActive: true } },
    },
    orderBy: { id: "asc" },
  });
}
