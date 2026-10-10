-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'APPROVED', 'REJECTED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('ASSIGNED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('LOAD_MISMATCH', 'DELIVERY_MISMATCH', 'DAY_SHORTAGE', 'DAY_SURPLUS', 'NIGHT_SHORTAGE', 'NIGHT_SURPLUS', 'CASH_MISMATCH', 'DISCOUNT', 'SHIFT_NOT_OPENED', 'SHIFT_NOT_CLOSED');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "movements" ADD COLUMN     "trip_id" INTEGER;

-- CreateTable
CREATE TABLE "delivery_requests" (
    "id" SERIAL NOT NULL,
    "point_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "comment" TEXT NOT NULL DEFAULT '',
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_items" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty_requested" INTEGER NOT NULL,
    "qty_approved" INTEGER,

    CONSTRAINT "request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "point_id" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'ASSIGNED',
    "loaded_at" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "accepted_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_items" (
    "id" SERIAL NOT NULL,
    "trip_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty_planned" INTEGER NOT NULL,
    "qty_loaded" INTEGER,
    "qty_unloaded" INTEGER,
    "qty_received" INTEGER,

    CONSTRAINT "trip_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" SERIAL NOT NULL,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "point_id" INTEGER,
    "user_id" INTEGER,
    "second_user_id" INTEGER,
    "product_id" INTEGER,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "trip_id" INTEGER,
    "resolution" TEXT,
    "resolved_by" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_requests_status_idx" ON "delivery_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "request_items_request_id_product_id_key" ON "request_items"("request_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "trips_request_id_key" ON "trips"("request_id");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_driver_id_idx" ON "trips"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_items_trip_id_product_id_key" ON "trip_items"("trip_id", "product_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "delivery_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "delivery_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_items" ADD CONSTRAINT "trip_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_second_user_id_fkey" FOREIGN KEY ("second_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
