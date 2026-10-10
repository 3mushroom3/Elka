"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/lib/action-types";

type Props = {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  // Текст подтверждения перед отправкой (для необратимых действий)
  confirm?: string;
  // Кнопка на всю ширину для телефонных экранов
  wide?: boolean;
};

export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  resetOnSuccess,
  confirm,
  wide,
}: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={className}
      // Отправляем вручную: иначе React очищает поля и при ошибке тоже
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      {state?.error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.ok}
        </p>
      )}
      <button type="submit" className={wide ? "btn mt-4 min-h-16 w-full text-lg" : "btn mt-4"} disabled={pending}>
        {pending ? "Сохраняю…" : submitLabel}
      </button>
    </form>
  );
}
