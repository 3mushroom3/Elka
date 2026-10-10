"use client";

import { useState, useTransition } from "react";
import { QtyInput } from "@/components/QtyInput";
import { createWriteoffAction } from "../actions";

const REASONS = [
  ["DEFECT", "Брак"],
  ["BROKEN", "Поломка"],
  ["THEFT", "Кража"],
  ["OTHER", "Другое"],
] as const;

const MAX_SIDE = 1600;

// Уменьшает снимок с камеры до ~200-400 КБ, чтобы он быстро уходил по мобильной сети.
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.8));
    return blob ?? file;
  } catch {
    // Браузер не смог прочитать снимок: отправляем как есть, сервер проверит
    return file;
  }
}

export function WriteoffForm({ products }: { products: { id: number; name: string }[] }) {
  const [reason, setReason] = useState<string>("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const blob = await compress(file);
    setPhoto(blob);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!reason) return setError("Выберите причину");
        if (!photo) return setError("Сделайте фото: без него списание не принимается");
        const data = new FormData(e.currentTarget);
        data.set("reason", reason);
        data.set("photo", photo, "photo.jpg");
        startTransition(async () => {
          const result = await createWriteoffAction(null, data);
          if (result?.error) setError(result.error);
        });
      }}
    >
      <div className="card">
        <label className="label" htmlFor="productId">
          Что списываем
        </label>
        <select id="productId" name="productId" className="input min-h-14 text-lg" required>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="mt-2">
          <QtyInput name="qty" label="Количество" defaultValue={1} />
        </div>
      </div>

      <div className="card">
        <p className="label">Причина</p>
        <div className="grid grid-cols-2 gap-2">
          {REASONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setReason(value)}
              className={`h-14 rounded-xl border text-lg ${
                reason === value
                  ? "border-emerald-600 bg-emerald-100 font-semibold"
                  : "border-zinc-300 bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="label mt-3" htmlFor="comment">
          Что случилось
        </label>
        <input id="comment" name="comment" className="input min-h-12" />
      </div>

      <div className="card">
        <label className="btn-secondary min-h-16 w-full cursor-pointer text-lg">
          {photo ? "Переснять фото" : "Сделать фото"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
        </label>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- локальный предпросмотр снимка
          <img src={preview} alt="Фото для списания" className="mt-3 w-full rounded-lg" />
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-100 p-4 text-lg text-red-800">
          {error}
        </p>
      )}
      <p className="text-sm text-zinc-500">
        До решения менеджера товар числится на точке. Пока запрос не рассмотрен, смену закрыть
        нельзя.
      </p>
      <button type="submit" className="btn min-h-16 w-full text-lg" disabled={pending}>
        {pending ? "Отправляю…" : "Отправить менеджеру"}
      </button>
    </form>
  );
}
