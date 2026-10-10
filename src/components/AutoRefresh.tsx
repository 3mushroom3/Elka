"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Раз в полминуты подтягивает свежие данные и счётчики, пока вкладка открыта
// и пользователь ничего не вводит.
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      const editing = ["INPUT", "SELECT", "TEXTAREA"].includes(
        document.activeElement?.tagName ?? "",
      );
      if (document.visibilityState === "visible" && !editing) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
