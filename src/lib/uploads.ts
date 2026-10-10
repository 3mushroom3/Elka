import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { prisma } from "./db";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
const MAX_SIZE = 5 * 1024 * 1024;

// Тип определяется по содержимому файла, а не по имени или заголовку от браузера.
function detectImage(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export async function saveImage(file: FormDataEntryValue | null, userId: number) {
  if (!(file instanceof File) || file.size === 0) {
    throw new DomainError("Приложите фото: без него списание не принимается");
  }
  if (file.size > MAX_SIZE) throw new DomainError("Фото слишком большое. Сделайте снимок заново.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = detectImage(bytes);
  if (!type) throw new DomainError("Файл не похож на фотографию. Сделайте снимок заново.");

  await mkdir(UPLOAD_DIR, { recursive: true });
  const fileName = `${randomUUID()}.${type.ext}`;
  await writeFile(path.join(UPLOAD_DIR, fileName), bytes);
  return prisma.attachment.create({
    data: { fileName, mime: type.mime, size: bytes.length, uploadedById: userId },
  });
}

// Убирает файл, если запрос, к которому он прикладывался, не сохранился.
export async function discardImage(attachmentId: number) {
  const attachment = await prisma.attachment.delete({ where: { id: attachmentId } });
  await unlink(path.join(UPLOAD_DIR, attachment.fileName)).catch(() => {});
}

export function readImage(fileName: string) {
  // Имя файла берётся только из базы; basename защищает от выхода из папки
  return readFile(path.join(UPLOAD_DIR, path.basename(fileName)));
}
