// Ссылка на выгрузку отчёта в Excel с текущими фильтрами страницы
export function ExportLink({
  report,
  params = {},
  label = "Выгрузить в Excel",
}: {
  report: string;
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  return (
    <a href={`/api/export/${report}${query ? `?${query}` : ""}`} className="btn-secondary">
      {label}
    </a>
  );
}
