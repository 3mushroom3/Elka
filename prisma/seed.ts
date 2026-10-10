// Начальные данные: аккаунт менеджера и справочник видов товара.
// Запуск: npm run seed (база должна быть запущена: npm run dev или npm run db)
import { PrismaClient, type ProductCategory } from "@prisma/client";
import { createProduct, createUser } from "../src/domain/catalog";

const prisma = new PrismaClient();

const PRODUCTS: [string, ProductCategory, number][] = [
  ["Ель", "TREE", 10],
  ["Сосна", "TREE", 10],
  ["Пихта", "TREE", 5],
  ["Централ (ель)", "TREE", 10],
  ["Централ (сосна)", "TREE", 10],
  ["Пень большой", "GOODS", 10],
  ["Пень средний", "GOODS", 10],
  ["Пень маленький", "GOODS", 10],
  ["Ветка пихты", "GOODS", 10],
  ["Веник", "GOODS", 10],
];

async function main() {
  const login = process.env.SEED_ADMIN_LOGIN ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";

  await prisma.$transaction(async (tx) => {
    if (!(await tx.user.findFirst({ where: { role: "MANAGER" } }))) {
      await createUser(tx, null, {
        login,
        fullName: "Главный менеджер",
        role: "MANAGER",
        password,
        pointIds: [],
      });
      console.log(`Создан менеджер: логин ${login}, пароль ${password}`);
      console.log("Смените пароль после первого входа: раздел «Сотрудники».");
    }
    if ((await tx.product.count()) === 0) {
      for (const [index, [name, category, commissionPercent]] of PRODUCTS.entries()) {
        await createProduct(tx, null, {
          name,
          category,
          commissionPercent,
          quickPrices: [],
          isCountable: true,
          sortOrder: (index + 1) * 10,
          isActive: true,
        });
      }
      console.log(`Добавлено видов товара: ${PRODUCTS.length}`);
    }
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
