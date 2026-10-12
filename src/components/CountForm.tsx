"use client";

import { useState } from "react";

export type CountProduct = { id: number; name: string };

// Пересчёт стволов на точке. Два способа ввода:
//  - список: продавец уже знает число и вбивает его;
//  - кликер: продавец идёт вдоль ряда и нажимает по разу на каждый ствол,
//    число держит экран, а не голова.
// Значения живут здесь, в форму уходят скрытыми полями qty_<id>.
export function CountForm({ products }: { products: CountProduct[] }) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [counting, setCounting] = useState<number | null>(null);

  const set = (id: number, value: string) => setValues((v) => ({ ...v, [id]: value }));
  const step = (id: number, delta: number) =>
    set(id, String(Math.max(0, (Number(values[id]) || 0) + delta)));

  const filled = products.filter((p) => (values[p.id] ?? "") !== "").length;
  const product = products.find((p) => p.id === counting) ?? null;

  if (product) {
    const current = Number(values[product.id]) || 0;
    const index = products.findIndex((p) => p.id === product.id);
    const next = products[index + 1];
    return (
      <div className="fixed inset-0 z-20 flex flex-col bg-[#f3f5f4] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* Пока открыт кликер, список скрыт: числа всё равно должны уйти в форму */}
        {products.map((p) => (
          <input key={p.id} type="hidden" name={`qty_${p.id}`} value={values[p.id] ?? ""} />
        ))}
        <div className="flex items-center justify-between">
          <p className="text-xl font-bold">{product.name}</p>
          <button type="button" className="btn-secondary min-h-12" onClick={() => setCounting(null)}>
            К списку
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Вид {index + 1} из {products.length}. Нажимайте на зелёное поле по разу на каждый ствол.
        </p>

        {/* Счётчик: само число и есть кнопка, промахнуться по ней нельзя */}
        <button
          type="button"
          onClick={() => step(product.id, 1)}
          className="mt-3 flex flex-1 flex-col items-center justify-center rounded-2xl bg-emerald-700 text-white shadow-sm active:bg-emerald-800"
        >
          <span className="text-[6rem] leading-none font-bold tabular-nums">{current}</span>
          <span className="mt-2 text-lg opacity-90">нажмите, чтобы +1</span>
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="min-h-14 rounded-xl border border-zinc-300 bg-white text-lg font-semibold active:bg-zinc-100"
            onClick={() => step(product.id, -1)}
          >
            − 1 (ошибся)
          </button>
          <button
            type="button"
            className="min-h-14 rounded-xl border border-zinc-300 bg-white text-lg font-semibold active:bg-zinc-100"
            onClick={() => set(product.id, "0")}
          >
            Сбросить в 0
          </button>
        </div>

        <button
          type="button"
          className="btn mt-2 min-h-16 text-lg"
          onClick={() => {
            // Досчитали вид: фиксируем число, даже если это ноль
            if ((values[product.id] ?? "") === "") set(product.id, "0");
            setCounting(next ? next.id : null);
          }}
        >
          {next ? `Готово, дальше: ${next.name}` : "Готово, к списку"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">
            Введено {filled} из {products.length}
          </p>
          <button
            type="button"
            className="btn-secondary min-h-12"
            onClick={() => setCounting(products[0]?.id ?? null)}
          >
            Считать кликером
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Кликер считает за вас: нажимайте на каждый ствол и переходите к следующему виду.
        </p>
      </div>

      <div className="card">
        {products.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 border-b border-zinc-100 py-2 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-lg leading-tight font-semibold">{p.name}</p>
              <button
                type="button"
                className="text-sm font-medium text-emerald-700 underline"
                onClick={() => setCounting(p.id)}
              >
                считать кликером
              </button>
            </div>
            <button
              type="button"
              className="h-14 w-14 shrink-0 rounded-xl border border-zinc-300 bg-white text-3xl font-semibold text-zinc-700 active:bg-zinc-100"
              onClick={() => step(p.id, -1)}
              aria-label={`${p.name}: меньше`}
            >
              −
            </button>
            <input
              name={`qty_${p.id}`}
              value={values[p.id] ?? ""}
              onChange={(e) => set(p.id, e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="0"
              aria-label={p.name}
              className="h-14 w-20 rounded-xl border border-zinc-300 bg-white text-center text-2xl font-bold tabular-nums outline-none focus:border-emerald-600"
            />
            <button
              type="button"
              className="h-14 w-14 shrink-0 rounded-xl border border-zinc-300 bg-white text-3xl font-semibold text-zinc-700 active:bg-zinc-100"
              onClick={() => step(p.id, 1)}
              aria-label={`${p.name}: больше`}
            >
              +
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
