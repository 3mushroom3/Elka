import { Role } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/labels";
import { createUserAction, updateUserAction } from "../actions";

type PointOption = { id: number; name: string };

function PointChecks({ points, selected }: { points: PointOption[]; selected: number[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-zinc-500">Сначала создайте точки.</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {points.map((p) => (
        <label key={p.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            name="pointIds"
            value={p.id}
            defaultChecked={selected.includes(p.id)}
          />
          {p.name}
        </label>
      ))}
    </div>
  );
}

export default async function StaffPage() {
  const me = await requireRole("MANAGER");
  const [users, points] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { fullName: "asc" }],
      include: { points: true },
    }),
    prisma.point.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <h1 className="h1">Сотрудники</h1>

      <div className="mb-6 flex flex-col gap-3">
        {users.map((u) => (
          <details key={u.id} className="card">
            <summary className="cursor-pointer">
              <span className="font-semibold">{u.fullName}</span>
              <span className="ml-2 text-sm text-zinc-500">
                {ROLE_LABEL[u.role]} · логин {u.login}
              </span>
              {!u.isActive && <span className="ml-2 text-sm text-red-600">отключён</span>}
            </summary>
            <ActionForm action={updateUserAction} submitLabel="Сохранить" className="mt-4">
              <input type="hidden" name="id" value={u.id} />
              <label className="label">Имя</label>
              <input name="fullName" defaultValue={u.fullName} className="input mb-3" required />
              {u.role === Role.SELLER && (
                <div className="mb-3">
                  <p className="label">Точки, на которых работает</p>
                  <PointChecks points={points} selected={u.points.map((p) => p.pointId)} />
                </div>
              )}
              <label className="label">Новый пароль (оставьте пустым, чтобы не менять)</label>
              <input
                name="newPassword"
                type="text"
                autoComplete="off"
                minLength={6}
                className="input mb-3"
              />
              {u.id === me.id ? (
                <input type="hidden" name="isActive" value="on" />
              ) : (
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="isActive" defaultChecked={u.isActive} />
                  Доступ в систему разрешён
                </label>
              )}
            </ActionForm>
          </details>
        ))}
      </div>

      <section className="card max-w-xl">
        <h2 className="h2">Новый сотрудник</h2>
        <ActionForm action={createUserAction} submitLabel="Создать аккаунт" resetOnSuccess>
          <label className="label">Имя</label>
          <input name="fullName" className="input mb-3" required />
          <label className="label">Роль</label>
          <select name="role" className="input mb-3" defaultValue={Role.SELLER}>
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <label className="label">Логин (латиницей)</label>
          <input
            name="login"
            className="input mb-3"
            autoCapitalize="none"
            autoComplete="off"
            required
          />
          <label className="label">Пароль (не короче 6 символов)</label>
          <input
            name="password"
            type="text"
            autoComplete="off"
            minLength={6}
            className="input mb-3"
            required
          />
          <p className="label">Точки (только для продавца)</p>
          <PointChecks points={points} selected={[]} />
        </ActionForm>
      </section>
    </>
  );
}
