import { ActionForm } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  formatDateTime,
  WRITEOFF_REASON_LABEL,
  WRITEOFF_STATUS_LABEL,
} from "@/lib/labels";
import { decideWriteoffAction } from "../actions";

export default async function WriteoffsPage() {
  await requireRole("MANAGER");
  const include = {
    point: { select: { name: true } },
    author: { select: { fullName: true } },
    product: { select: { name: true } },
    decidedBy: { select: { fullName: true } },
  } as const;
  const [pending, history] = await Promise.all([
    prisma.writeoffRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { id: "asc" },
      include,
    }),
    prisma.writeoffRequest.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { id: "desc" },
      take: 50,
      include,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Списания"
        hint="Продавец просит списать брак, поломку или кражу. Посмотрите фото и решите."
      />

      {pending.length === 0 && (
        <p className="card mb-6 text-sm text-zinc-500">
          Запросов на списание нет.
        </p>
      )}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {pending.map((w) => (
          <section key={w.id} className="card border-l-8 border-l-amber-500">
            <h2 className="h2">
              {w.product.name} × {w.qty} · {WRITEOFF_REASON_LABEL[w.reason]}
            </h2>
            <p className="-mt-2 text-sm text-zinc-500">
              №{w.id} · {w.point.name} · {w.author.fullName} ·{" "}
              {formatDateTime(w.createdAt)}
            </p>
            {w.comment && <p className="mt-2">«{w.comment}»</p>}
            <a
              href={`/api/photo/${w.photoId}`}
              target="_blank"
              rel="noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- фото отдаётся через проверку доступа */}
              <img
                src={`/api/photo/${w.photoId}`}
                alt="Фото списываемого товара"
                className="mt-3 max-h-80 rounded-lg"
              />
            </a>
            <p className="mt-2 text-sm text-zinc-500">
              Пока запрос не рассмотрен, продавец не может закрыть смену.
            </p>
            <ActionForm
              action={decideWriteoffAction}
              submitLabel="Списать"
              confirm="Списать товар с точки?"
            >
              <input type="hidden" name="writeoffId" value={w.id} />
              <input type="hidden" name="decision" value="approve" />
            </ActionForm>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-red-700">
                Отказать
              </summary>
              <ActionForm
                action={decideWriteoffAction}
                submitLabel="Отказать в списании"
              >
                <input type="hidden" name="writeoffId" value={w.id} />
                <input type="hidden" name="decision" value="reject" />
                <label className="label mt-2">
                  Причина отказа (её увидит продавец)
                </label>
                <input name="comment" className="input" required />
              </ActionForm>
              <p className="mt-2 text-sm text-zinc-500">
                После отказа товар остаётся на учёте точки. Если вечером его не
                окажется, это будет недостача продавца.
              </p>
            </details>
          </section>
        ))}
      </div>

      <section className="card overflow-x-auto">
        <h2 className="h2">Рассмотренные</h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Точка</th>
                <th>Продавец</th>
                <th>Что</th>
                <th>Причина</th>
                <th>Решение</th>
                <th>Фото</th>
              </tr>
            </thead>
            <tbody>
              {history.map((w) => (
                <tr key={w.id}>
                  <td>{w.id}</td>
                  <td className="whitespace-nowrap">
                    {formatDateTime(w.createdAt)}
                  </td>
                  <td>{w.point.name}</td>
                  <td>{w.author.fullName}</td>
                  <td className="whitespace-nowrap">
                    {w.product.name} × {w.qty}
                  </td>
                  <td>
                    {WRITEOFF_REASON_LABEL[w.reason]}
                    {w.comment && (
                      <span className="block text-zinc-500">{w.comment}</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        w.status === "REJECTED"
                          ? "text-red-600"
                          : "text-emerald-700"
                      }
                    >
                      {WRITEOFF_STATUS_LABEL[w.status]}
                    </span>
                    <span className="block text-zinc-500">
                      {w.decidedBy?.fullName}
                      {w.decisionComment && `: ${w.decisionComment}`}
                    </span>
                  </td>
                  <td>
                    <a
                      href={`/api/photo/${w.photoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-700 underline"
                    >
                      Открыть
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
