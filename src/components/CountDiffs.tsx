type Count = {
  id: number;
  kind: "MORNING" | "EVENING";
  items: { id: number; diff: number; product: { name: string } }[];
};

// Результат пересчётов смены для продавца: показывается только после ввода.
export function CountDiffs({ counts }: { counts: Count[] }) {
  return (
    <>
      {counts.map((c) => (
        <div
          key={c.id}
          className={`rounded-xl p-3 ${c.items.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}
        >
          <p className="font-semibold">
            {c.kind === "MORNING" ? "Утренний" : "Вечерний"} пересчёт:{" "}
            {c.items.length ? "есть расхождения" : "расхождений нет"}
          </p>
          {c.items.map((i) => (
            <p key={i.id}>
              {i.product.name}: {i.diff > 0 ? `лишних ${i.diff}` : `не хватает ${-i.diff}`}
            </p>
          ))}
          {c.items.length > 0 && <p className="mt-1 text-sm">Менеджер уже видит это расхождение.</p>}
        </div>
      ))}
    </>
  );
}
