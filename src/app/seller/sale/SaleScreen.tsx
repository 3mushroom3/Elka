"use client";

import type { PaymentMethod } from "@prisma/client";
import { useState, useTransition } from "react";
import { recordSaleAction } from "../actions";

type Product = { id: number; name: string; quickPrices: number[] };
type Draft = {
  product: Product;
  clientKey: string;
  sticker: string;
  discounted: boolean;
  price: string;
  reason: string;
  qty: number;
};

const REASONS = ["Торг", "Дефект", "Последняя", "Оптом"];
const PAYMENTS: { value: PaymentMethod; label: string; className: string }[] = [
  { value: "CASH", label: "Наличные", className: "bg-emerald-700" },
  { value: "TRANSFER", label: "Перевод", className: "bg-sky-700" },
  { value: "CARD", label: "Карта", className: "bg-violet-700" },
];
const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

export function SaleScreen({ products }: { products: Product[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState<"price" | "payment">("price");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pick = (product: Product) => {
    setDone(null);
    setError(null);
    setStep("price");
    setDraft({
      product,
      clientKey: crypto.randomUUID(),
      sticker: "",
      discounted: false,
      price: "",
      reason: "",
      qty: 1,
    });
  };

  // Шаг 1: выбор вида
  if (!draft) {
    return (
      <>
        {done && (
          <p className="rounded-xl bg-emerald-100 p-4 text-lg font-semibold text-emerald-900">
            ✓ {done}
          </p>
        )}
        <p className="text-sm text-zinc-500">Что продаёте?</p>
        <div className="grid grid-cols-2 gap-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className="min-h-24 rounded-xl border border-zinc-300 bg-white p-3 text-xl font-bold shadow-sm active:bg-emerald-50"
            >
              {p.name}
            </button>
          ))}
        </div>
      </>
    );
  }

  const sticker = Number(draft.sticker) || 0;
  const price = draft.discounted ? Number(draft.price) || 0 : sticker;
  const total = price * draft.qty;
  // Куда сейчас вводятся цифры: в цену стикера или в цену со скидкой
  const field = draft.discounted ? "price" : "sticker";
  const type = (digit: string) =>
    setDraft((d) => d && { ...d, [field]: (d[field] + digit).replace(/^0+/, "").slice(0, 7) });
  const erase = () => setDraft((d) => d && { ...d, [field]: d[field].slice(0, -1) });

  const priceProblem =
    sticker <= 0
      ? "Введите цену со стикера"
      : draft.discounted && draft.price === ""
        ? "Введите цену, за которую продаёте"
        : draft.discounted && price >= sticker
          ? "Цена со скидкой должна быть ниже стикера"
          : draft.discounted && !draft.reason.trim()
            ? "Укажите причину скидки"
            : null;

  const submit = (payment: PaymentMethod) => {
    setError(null);
    startTransition(async () => {
      const result = await recordSaleAction({
        productId: draft.product.id,
        qty: draft.qty,
        stickerPrice: sticker,
        price,
        discountReason: draft.discounted ? draft.reason : "",
        payment,
        clientKey: draft.clientKey,
      });
      if (result.ok) {
        const label = PAYMENTS.find((p) => p.value === payment)!.label.toLowerCase();
        setDone(`${draft.product.name} × ${draft.qty}, ${rub(total)}, ${label}`);
        setDraft(null);
      } else {
        setError(result.error);
      }
    });
  };

  // Клавиша ниже привычного: вместе с «Дальше» весь блок должен помещаться
  // в нижнюю треть экрана телефона.
  const key =
    "h-14 rounded-xl border border-zinc-300 bg-white text-2xl font-semibold active:bg-zinc-100";

  // Шаг 3: способ оплаты
  if (step === "payment") {
    return (
      <>
        <div className="card text-center">
          <p className="text-lg">
            {draft.product.name} × {draft.qty}
          </p>
          <p className="text-4xl font-bold tabular-nums">{rub(total)}</p>
          {draft.discounted && (
            <p className="text-sm text-amber-700">
              стикер {rub(sticker)}, скидка: {draft.reason}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-red-100 p-4 text-lg text-red-800">
            {error}
          </p>
        )}
        <p className="text-sm text-zinc-500">Как оплатили?</p>
        {PAYMENTS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={pending}
            onClick={() => submit(p.value)}
            className={`min-h-20 rounded-xl text-2xl font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-50 ${p.className}`}
          >
            {p.label}
          </button>
        ))}
        <button type="button" className="btn-secondary min-h-14" onClick={() => setStep("price")}>
          ‹ Назад к цене
        </button>
      </>
    );
  }

  // Шаг 2: цена
  return (
    <>
      <div className="card">
        <p className="flex items-center justify-between">
          <span className="text-xl font-bold">{draft.product.name}</span>
          <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
            Другой вид
          </button>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <div
            className={`rounded-xl border-2 p-2 ${field === "sticker" ? "border-emerald-600" : "border-zinc-200"}`}
          >
            <p className="text-sm text-zinc-500">Цена на стикере</p>
            <p className="text-3xl font-bold tabular-nums">{sticker ? rub(sticker) : "—"}</p>
          </div>
          <div
            className={`rounded-xl border-2 p-2 ${field === "price" ? "border-amber-500" : "border-zinc-200"}`}
          >
            <p className="text-sm text-zinc-500">Продаю за</p>
            <p className="text-3xl font-bold tabular-nums">{price ? rub(price) : "—"}</p>
          </div>
        </div>
      </div>

      {/* Отметка о цене не по стикеру стоит наверху: её ставят до набора цены,
          а не после, и рука с клавиатуры внизу сюда не тянется. */}
      <div className="card">
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input
            type="checkbox"
            className="h-6 w-6"
            checked={draft.discounted}
            onChange={(e) =>
              setDraft({ ...draft, discounted: e.target.checked, price: "", reason: "" })
            }
          />
          Продаю дешевле стикера
        </label>
        {draft.discounted && (
          <>
            <p className="mt-2 text-sm text-zinc-500">
              Введите цифрами цену продажи и укажите причину. Менеджер увидит эту продажу.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDraft({ ...draft, reason: r })}
                  className={`h-12 rounded-xl border text-lg ${
                    draft.reason === r
                      ? "border-amber-500 bg-amber-100 font-semibold"
                      : "border-zinc-300 bg-white"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              className="input mt-2 min-h-12"
              placeholder="Другая причина"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </>
        )}
      </div>

      <div className="card flex items-center justify-between">
        <span className="text-lg">Количество</span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            className="h-12 w-12 rounded-xl border border-zinc-300 text-2xl"
            onClick={() => setDraft({ ...draft, qty: Math.max(1, draft.qty - 1) })}
            aria-label="Меньше"
          >
            −
          </button>
          <span className="w-8 text-center text-2xl font-bold tabular-nums">{draft.qty}</span>
          <button
            type="button"
            className="h-12 w-12 rounded-xl border border-zinc-300 text-2xl"
            onClick={() => setDraft({ ...draft, qty: draft.qty + 1 })}
            aria-label="Больше"
          >
            +
          </button>
        </span>
      </div>

      {/* Клавиатура и кнопка «Дальше» прижаты к низу экрана: телефон лежит
          в руке, цифры набираются большим пальцем, список выше прокручивается. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-2 border-t border-zinc-200 bg-[#f3f5f4]/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {!draft.discounted && draft.product.quickPrices.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {draft.product.quickPrices.map((p) => (
              <button
                key={p}
                type="button"
                className="h-14 rounded-xl bg-emerald-700 text-xl font-bold text-white active:scale-[0.98]"
                onClick={() => {
                  setDraft({ ...draft, sticker: String(p) });
                  // Цена со стикера выбрана одной кнопкой: сразу к оплате
                  if (draft.qty === 1) setStep("payment");
                }}
              >
                {p.toLocaleString("ru-RU")}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((d) => (
            <button key={d} type="button" className={key} onClick={() => type(d)}>
              {d}
            </button>
          ))}
          <button type="button" className={key} onClick={erase} aria-label="Стереть">
            ⌫
          </button>
        </div>

        <button
          type="button"
          className="btn min-h-16 text-xl"
          disabled={priceProblem !== null}
          onClick={() => setStep("payment")}
        >
          {priceProblem ?? `Дальше: ${rub(total)}`}
        </button>
      </div>
    </>
  );
}
