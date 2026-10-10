import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readImage } from "@/lib/uploads";

// Фото списаний: менеджеру доступны все, остальным только загруженные ими самими.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Нет доступа", { status: 401 });
  const id = Number((await params).id);
  const attachment = Number.isInteger(id)
    ? await prisma.attachment.findUnique({ where: { id } })
    : null;
  if (!attachment || (user.role !== "MANAGER" && attachment.uploadedById !== user.id)) {
    return new Response("Не найдено", { status: 404 });
  }
  try {
    const bytes = await readImage(attachment.fileName);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mime,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Файл не найден", { status: 404 });
  }
}
