"use client";

import { useState } from "react";

// Поле количества с крупными кнопками «−» и «+»: удобно нажимать в перчатках.
export function QtyInput({
  name,
  label,
  hint,
  defaultValue,
  max,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: number;
  max?: number;
}) {
  const [value, setValue] = useState(defaultValue === undefined ? "" : String(defaultValue));
  const step = (delta: number) => {
    const next = Math.max(0, (Number(value) || 0) + delta);
    setValue(String(max === undefined ? next : Math.min(next, max)));
  };
  const button =
    "h-14 w-14 shrink-0 rounded-xl border border-zinc-300 bg-white text-3xl font-semibold text-zinc-700 active:bg-zinc-100";

  return (
    <div className="flex items-center gap-2 border-b border-zinc-100 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-lg leading-tight font-semibold">{label}</p>
        {hint && <p className="text-sm text-zinc-500">{hint}</p>}
      </div>
      <button type="button" className={button} onClick={() => step(-1)} aria-label="Меньше">
        −
      </button>
      <input
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        placeholder="0"
        aria-label={label}
        className="h-14 w-20 rounded-xl border border-zinc-300 bg-white text-center text-2xl font-bold tabular-nums outline-none focus:border-emerald-600"
      />
      <button type="button" className={button} onClick={() => step(1)} aria-label="Больше">
        +
      </button>
    </div>
  );
}
