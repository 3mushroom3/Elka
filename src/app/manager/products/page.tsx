import { type Product, ProductCategory } from "@prisma/client";
import { PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { requireRole } from "@/lib/auth";
import { CATEGORY_LABEL } from "@/lib/labels";
import { listProducts } from "@/lib/queries";
import { createProductAction, updateProductAction } from "../actions";

function ProductFields({ product }: { product?: Product }) {
  return (
    <>
      <label className="label">Название</label>
      <input
        name="name"
        defaultValue={product?.name}
        className="input mb-3"
        required
      />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Группа</label>
          <select
            name="category"
            defaultValue={product?.category ?? ProductCategory.TREE}
            className="input"
          >
            {Object.values(ProductCategory).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Продавцу, %</label>
          <input
            name="commissionPercent"
            type="number"
            min={0}
            max={100}
            defaultValue={product?.commissionPercent ?? 10}
            className="input"
            required
          />
        </div>
        <div>
          <label className="label">Порядок в списке</label>
          <input
            name="sortOrder"
            type="number"
            defaultValue={product?.sortOrder ?? 0}
            className="input"
          />
        </div>
      </div>
      <label className="label mt-3">
        Частые цены со стикеров через запятую (кнопки на экране продажи)
      </label>
      <input
        name="quickPrices"
        defaultValue={product?.quickPrices.join(", ")}
        placeholder="1500, 2000, 2500"
        className="input"
      />
      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          name="isCountable"
          defaultChecked={product?.isCountable ?? true}
        />
        Пересчитывается утром и вечером
      </label>
    </>
  );
}

export default async function ProductsPage() {
  await requireRole("MANAGER");
  const products = await listProducts(false);

  return (
    <>
      <PageHeader
        title="Виды товара"
        hint="Что продаём, какой процент получает продавец и какие цены показывать кнопками при продаже."
      />

      <div className="mb-6 flex flex-col gap-3">
        {products.map((p) => (
          <details key={p.id} className="card">
            <summary className="cursor-pointer">
              <span className="font-semibold">{p.name}</span>
              <span className="ml-2 text-sm text-zinc-500">
                {CATEGORY_LABEL[p.category]} · продавцу {p.commissionPercent}%
                {p.quickPrices.length > 0 &&
                  ` · цены: ${p.quickPrices.join(", ")}`}
              </span>
              {!p.isActive && (
                <span className="ml-2 text-sm text-red-600">скрыт</span>
              )}
            </summary>
            <ActionForm
              action={updateProductAction}
              submitLabel="Сохранить"
              className="mt-4"
            >
              <input type="hidden" name="id" value={p.id} />
              <ProductFields product={p} />
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={p.isActive}
                />
                Используется (виден продавцам и в заявках)
              </label>
            </ActionForm>
          </details>
        ))}
      </div>

      <section className="card max-w-xl">
        <h2 className="h2">Новый вид</h2>
        <ActionForm
          action={createProductAction}
          submitLabel="Добавить вид"
          resetOnSuccess
        >
          <ProductFields />
        </ActionForm>
      </section>
    </>
  );
}
