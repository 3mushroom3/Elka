import { LocationType, ProductCategory, Role } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "./audit";
import { DomainError } from "./errors";
import { getBalances } from "./ledger";
import { hashPassword } from "./password";

const MIN_PASSWORD_LENGTH = 6;

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`);
  }
}

async function hasStock(tx: Tx, locationId: number) {
  const balances = await getBalances(tx, locationId);
  return [...balances.values()].some((qty) => qty !== 0);
}

// ---------- Сотрудники ----------

export type UserInput = {
  login: string;
  fullName: string;
  role: Role;
  password: string;
  pointIds: number[];
};

export async function createUser(tx: Tx, actorId: number | null, input: UserInput) {
  const login = input.login.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
    throw new DomainError("Логин: от 3 до 32 латинских букв, цифр, точек или дефисов");
  }
  if (!input.fullName.trim()) throw new DomainError("Укажите имя сотрудника");
  checkPassword(input.password);
  if (await tx.user.findUnique({ where: { login } })) {
    throw new DomainError("Сотрудник с таким логином уже есть");
  }

  const user = await tx.user.create({
    data: {
      login,
      fullName: input.fullName.trim(),
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
  });
  // У каждого водителя своё место учёта: то, что он загрузил и ещё не сдал.
  if (user.role === Role.DRIVER) {
    await tx.location.create({ data: { type: LocationType.DRIVER, driverId: user.id } });
  }
  if (user.role === Role.SELLER && input.pointIds.length > 0) {
    await tx.userPoint.createMany({
      data: input.pointIds.map((pointId) => ({ userId: user.id, pointId })),
    });
  }
  await audit(tx, actorId, "user.create", "user", user.id, {
    login,
    role: user.role,
    pointIds: input.pointIds,
  });
  return user;
}

export async function updateUser(
  tx: Tx,
  actorId: number,
  userId: number,
  input: { fullName: string; isActive: boolean; pointIds: number[]; newPassword?: string },
) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("Сотрудник не найден");
  if (!input.fullName.trim()) throw new DomainError("Укажите имя сотрудника");
  if (userId === actorId && !input.isActive) {
    throw new DomainError("Нельзя отключить собственный аккаунт");
  }
  if (!input.isActive && user.role === Role.DRIVER) {
    const loc = await tx.location.findUnique({ where: { driverId: userId } });
    if (loc && (await hasStock(tx, loc.id))) {
      throw new DomainError("За водителем числится товар: сначала примите его на склад");
    }
  }

  const data: { fullName: string; isActive: boolean; passwordHash?: string } = {
    fullName: input.fullName.trim(),
    isActive: input.isActive,
  };
  if (input.newPassword) {
    checkPassword(input.newPassword);
    data.passwordHash = await hashPassword(input.newPassword);
  }
  await tx.user.update({ where: { id: userId }, data });

  if (user.role === Role.SELLER) {
    await tx.userPoint.deleteMany({ where: { userId } });
    if (input.pointIds.length > 0) {
      await tx.userPoint.createMany({
        data: input.pointIds.map((pointId) => ({ userId, pointId })),
      });
    }
  }
  // Отключение и смена пароля сразу закрывают все сессии сотрудника.
  if (!input.isActive || input.newPassword) {
    await tx.session.deleteMany({ where: { userId } });
  }
  await audit(tx, actorId, "user.update", "user", userId, {
    fullName: data.fullName,
    isActive: data.isActive,
    pointIds: input.pointIds,
    passwordChanged: Boolean(input.newPassword),
  });
}

// ---------- Точки ----------

export type PointInput = {
  name: string;
  address: string;
  openDeadline: string;
  closeDeadline: string;
  lowStockThreshold: number;
  isActive: boolean;
};

function checkPoint(input: PointInput) {
  if (!input.name.trim()) throw new DomainError("Укажите название точки");
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(input.openDeadline) || !time.test(input.closeDeadline)) {
    throw new DomainError("Время указывается в формате ЧЧ:ММ");
  }
  if (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0) {
    throw new DomainError("Порог низкого остатка не может быть отрицательным");
  }
}

export async function createPoint(tx: Tx, actorId: number, input: PointInput) {
  checkPoint(input);
  const name = input.name.trim();
  if (await tx.point.findUnique({ where: { name } })) {
    throw new DomainError("Точка с таким названием уже есть");
  }
  const point = await tx.point.create({
    data: { ...input, name, address: input.address.trim() },
  });
  await tx.location.create({ data: { type: LocationType.POINT, pointId: point.id } });
  await audit(tx, actorId, "point.create", "point", point.id, { name });
  return point;
}

export async function updatePoint(tx: Tx, actorId: number, pointId: number, input: PointInput) {
  checkPoint(input);
  const name = input.name.trim();
  const same = await tx.point.findUnique({ where: { name } });
  if (same && same.id !== pointId) throw new DomainError("Точка с таким названием уже есть");
  if (!input.isActive) {
    const loc = await tx.location.findUnique({ where: { pointId } });
    if (loc && (await hasStock(tx, loc.id))) {
      throw new DomainError("На точке числится товар: закрыть её можно только с нулевым остатком");
    }
  }
  await tx.point.update({
    where: { id: pointId },
    data: { ...input, name, address: input.address.trim() },
  });
  await audit(tx, actorId, "point.update", "point", pointId, { ...input, name });
}

// ---------- Виды товара ----------

export type ProductInput = {
  name: string;
  category: ProductCategory;
  commissionPercent: number;
  quickPrices: number[];
  isCountable: boolean;
  sortOrder: number;
  isActive: boolean;
};

function checkProduct(input: ProductInput) {
  if (!input.name.trim()) throw new DomainError("Укажите название");
  if (
    !Number.isInteger(input.commissionPercent) ||
    input.commissionPercent < 0 ||
    input.commissionPercent > 100
  ) {
    throw new DomainError("Процент продавцу: целое число от 0 до 100");
  }
  if (input.quickPrices.some((p) => !Number.isInteger(p) || p <= 0)) {
    throw new DomainError("Цены: целые числа больше нуля через запятую");
  }
}

export async function createProduct(tx: Tx, actorId: number | null, input: ProductInput) {
  checkProduct(input);
  const name = input.name.trim();
  if (await tx.product.findUnique({ where: { name } })) {
    throw new DomainError("Такой вид уже есть");
  }
  const product = await tx.product.create({ data: { ...input, name } });
  await audit(tx, actorId, "product.create", "product", product.id, { ...input, name });
  return product;
}

export async function updateProduct(
  tx: Tx,
  actorId: number,
  productId: number,
  input: ProductInput,
) {
  checkProduct(input);
  const name = input.name.trim();
  const same = await tx.product.findUnique({ where: { name } });
  if (same && same.id !== productId) throw new DomainError("Такой вид уже есть");
  await tx.product.update({ where: { id: productId }, data: { ...input, name } });
  await audit(tx, actorId, "product.update", "product", productId, { ...input, name });
}
