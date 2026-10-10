-- CreateEnum
CREATE TYPE "WriteoffReason" AS ENUM ('DEFECT', 'BROKEN', 'THEFT', 'OTHER');

-- CreateEnum
CREATE TYPE "WriteoffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IncidentOutcome" AS ENUM ('CHARGED', 'NOT_CHARGED');

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "charged_user_id" INTEGER,
ADD COLUMN     "outcome" "IncidentOutcome";

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "incident_id" INTEGER,
ADD COLUMN     "writeoff_id" INTEGER;

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaded_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writeoff_requests" (
    "id" SERIAL NOT NULL,
    "point_id" INTEGER NOT NULL,
    "shift_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" "WriteoffReason" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "photo_id" INTEGER NOT NULL,
    "status" "WriteoffStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "writeoff_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_file_name_key" ON "attachments"("file_name");

-- CreateIndex
CREATE INDEX "writeoff_requests_status_idx" ON "writeoff_requests"("status");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_writeoff_id_fkey" FOREIGN KEY ("writeoff_id") REFERENCES "writeoff_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_charged_user_id_fkey" FOREIGN KEY ("charged_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writeoff_requests" ADD CONSTRAINT "writeoff_requests_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writeoff_requests" ADD CONSTRAINT "writeoff_requests_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writeoff_requests" ADD CONSTRAINT "writeoff_requests_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writeoff_requests" ADD CONSTRAINT "writeoff_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writeoff_requests" ADD CONSTRAINT "writeoff_requests_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writeoff_requests" ADD CONSTRAINT "writeoff_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
