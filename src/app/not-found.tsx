import Link from "next/link";

// Открыли чужой или удалённый рейс, смену, продажу.
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <div className="card">
        <h1 className="text-xl font-bold">Не найдено</h1>
        <p className="mt-2 text-zinc-600">
          Запись удалена или открыта не из вашего аккаунта. Вернитесь на главную и начните заново.
        </p>
      </div>
      <Link href="/" className="btn min-h-14 text-lg">
        На главную
      </Link>
    </div>
  );
}
