import Link from "next/link";

type Tone = "green" | "amber" | "red" | "gray" | "blue";

// Цветная метка статуса
export function Chip({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

// Заголовок страницы: название, одна строка «зачем эта страница» и кнопки справа
export function PageHeader({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{title}</h1>
        {hint && <p className="mt-1 max-w-2xl text-sm text-zinc-500">{hint}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

// Крупная цифра с подписью
export function Stat({
  label,
  value,
  sub,
  href,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  href?: string;
  tone?: "red" | "amber";
}) {
  const color =
    tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "";
  const body = (
    <>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="card block transition hover:border-emerald-500"
    >
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

// Пустое состояние: вместо пустой таблицы
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-zinc-500">
      {children}
    </p>
  );
}

// Число в ячейке таблицы: ноль показывается бледным прочерком
export function Qty({ value, signed }: { value: number; signed?: boolean }) {
  if (value === 0) return <span className="zero">–</span>;
  return <>{signed && value > 0 ? `+${value}` : value}</>;
}

const TRIP_STEPS = [
  ["ASSIGNED", "Назначен"],
  ["LOADED", "Загружен"],
  ["IN_TRANSIT", "В пути"],
  ["DELIVERED", "Выгружен"],
  ["ACCEPTED", "Принят"],
] as const;

// Шкала этапов рейса: пройденные зелёные, текущий выделен
export function TripSteps({ status }: { status: string }) {
  const current = TRIP_STEPS.findIndex(([key]) => key === status);
  return (
    <ol className="my-3 flex items-start">
      {TRIP_STEPS.map(([key, label], index) => {
        const done = index < current;
        const now = index === current;
        return (
          <li
            key={key}
            className="flex flex-1 flex-col items-center text-center"
          >
            <div className="flex w-full items-center">
              <span
                className={`h-0.5 flex-1 ${index === 0 ? "invisible" : done || now ? "bg-emerald-600" : "bg-zinc-200"}`}
              />
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-emerald-600 text-white"
                    : now
                      ? "bg-emerald-600 text-white ring-4 ring-emerald-100"
                      : "bg-zinc-200 text-zinc-500"
                }`}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={`h-0.5 flex-1 ${index === TRIP_STEPS.length - 1 ? "invisible" : done ? "bg-emerald-600" : "bg-zinc-200"}`}
              />
            </div>
            <span
              className={`mt-1 text-xs ${now ? "font-semibold text-emerald-800" : "text-zinc-500"}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
