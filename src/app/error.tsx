"use client";

import Link from "next/link";
import { useEffect } from "react";

// Любая ошибка на странице: вместо пустого экрана показываем, что случилось,
// и даём вернуться. Сотрудник на точке не должен упираться в белый экран.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Ошибка страницы:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="card">
        <h1 className="text-xl font-bold">Страница не открылась</h1>
        <p className="mt-2 text-zinc-600">
          Это сбой программы, а не ваша ошибка. Данные не потеряны: всё, что вы уже подтвердили,
          сохранено.
        </p>
        {error.digest && (
          <p className="mt-3 text-sm text-zinc-500">
            Код для менеджера: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
      <button type="button" className="btn min-h-14 text-lg" onClick={reset}>
        Попробовать снова
      </button>
      <Link href="/" className="btn-secondary min-h-12">
        На главную
      </Link>
    </div>
  );
}
