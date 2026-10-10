-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'COUNTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CountKind" AS ENUM ('MORNING', 'EVENING');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD');

-- CreateEnum
CREATE TYPE "CancelStatus" AS ENUM ('NONE', 'REQUESTED', 'CANCELLED', 'REJECTED');

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "sale_id" INTEGER,
ADD COLUMN     "shift_id" INTEGER;

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "sale_id" INTEGER,
ADD COLUMN     "shift_id" INTEGER;

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "point_id" INTEGER NOT NULL,
    "seller_id" INTEGER NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cash_expected" INTEGER,
    "cash_actual" INTEGER,
    "cash_received_at" TIMESTAMP(3),
    "cash_received_by" INTEGER,
    "stickers_checked_at" TIMESTAMP(3),
    "stickers_checked_by" INTEGER,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" SERIAL NOT NULL,
    "shift_id" INTEGER NOT NULL,
    "kind" "CountKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" SERIAL NOT NULL,
    "count_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty_expected" INTEGER NOT NULL,
    "qty_actual" INTEGER NOT NULL,
    "diff" INTEGER NOT NULL,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" SERIAL NOT NULL,
    "shift_id" INTEGER NOT NULL,
    "point_id" INTEGER NOT NULL,
    "seller_id" INTEGER NOT NULL,
    "payment" "PaymentMethod" NOT NULL,
    "total" INTEGER NOT NULL,
    "client_key" TEXT,
    "cancel_status" "CancelStatus" NOT NULL DEFAULT 'NONE',
    "cancel_reason" TEXT,
    "cancel_requested_at" TIMESTAMP(3),
    "cancel_decided_by" INTEGER,
    "cancel_decided_at" TIMESTAMP(3),
    "cancel_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" SERIAL NOT NULL,
    "sale_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "sticker_price" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "discount_reason" TEXT,
    "commission_percent" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_point_id_opened_at_idx" ON "shifts"("point_id", "opened_at");

-- CreateIndex
CREATE INDEX "shifts_seller_id_idx" ON "shifts"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_shift_id_kind_key" ON "stock_counts"("shift_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_count_id_product_id_key" ON "stock_count_items"("count_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_client_key_key" ON "sales"("client_key");

-- CreateIndex
CREATE INDEX "sales_shift_id_idx" ON "sales"("shift_id");

-- CreateIndex
CREATE INDEX "sales_point_id_created_at_idx" ON "sales"("point_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_cash_received_by_fkey" FOREIGN KEY ("cash_received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_stickers_checked_by_fkey" FOREIGN KEY ("stickers_checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancel_decided_by_fkey" FOREIGN KEY ("cancel_decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- На точке одновременно может быть только одна незакрытая смена,
-- и у продавца тоже только одна.
CREATE UNIQUE INDEX shifts_one_open_per_point ON shifts (point_id) WHERE status <> 'CLOSED';
CREATE UNIQUE INDEX shifts_one_open_per_seller ON shifts (seller_id) WHERE status <> 'CLOSED';

ALTER TABLE sale_items ADD CONSTRAINT sale_items_qty_positive CHECK (qty > 0);
ALTER TABLE sale_items ADD CONSTRAINT sale_items_price_range
  CHECK (price >= 0 AND price <= sticker_price);
