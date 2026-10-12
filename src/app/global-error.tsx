"use client";

// Сбой в самой оболочке приложения: здесь своей разметки нет, поэтому
// страница собирается целиком, с собственными html и body.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#f3f5f4",
          color: "#18211d",
          margin: 0,
          padding: "24px",
        }}
      >
        <h1 style={{ fontSize: "20px" }}>Приложение не запустилось</h1>
        <p>Обновите страницу. Если не помогает, сообщите менеджеру.</p>
        {error.digest && <p style={{ color: "#6b7280" }}>Код: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "16px",
            minHeight: "48px",
            padding: "0 20px",
            borderRadius: "12px",
            border: 0,
            background: "#047857",
            color: "#fff",
            fontSize: "16px",
            fontWeight: 600,
          }}
        >
          Обновить
        </button>
      </body>
    </html>
  );
}
