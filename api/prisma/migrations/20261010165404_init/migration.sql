-- CreateEnum
CREATE TYPE "MenuCategory" AS ENUM ('KOPI', 'NON_KOPI', 'MAKANAN', 'SNACK', 'LAINNYA');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKE_AWAY');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QRIS', 'TRANSFER', 'E_WALLET');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "menu_items" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MenuCategory" NOT NULL DEFAULT 'KOPI',
    "price" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baristas" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "baristas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "queue_date" DATE NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "order_type" "OrderType" NOT NULL DEFAULT 'DINE_IN',
    "table_number" TEXT,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "note" TEXT,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "payment_method" "PaymentMethod",
    "paid_at" TIMESTAMP(3),
    "barista_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "queue_id" INTEGER NOT NULL,
    "menu_item_id" INTEGER,
    "name_snapshot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" SERIAL NOT NULL,
    "entry_date" DATE NOT NULL,
    "type" "LedgerType" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "description" TEXT,
    "queue_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_name_key" ON "menu_items"("name");

-- CreateIndex
CREATE INDEX "menu_items_category_active_idx" ON "menu_items"("category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "baristas_name_key" ON "baristas"("name");

-- CreateIndex
CREATE INDEX "queues_queue_date_status_idx" ON "queues"("queue_date", "status");

-- CreateIndex
CREATE INDEX "queues_payment_status_idx" ON "queues"("payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "queues_queue_date_number_key" ON "queues"("queue_date", "number");

-- CreateIndex
CREATE INDEX "order_items_queue_id_idx" ON "order_items"("queue_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_queue_id_key" ON "ledger_entries"("queue_id");

-- CreateIndex
CREATE INDEX "ledger_entries_entry_date_type_idx" ON "ledger_entries"("entry_date", "type");

-- CreateIndex
CREATE INDEX "ledger_entries_category_idx" ON "ledger_entries"("category");

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_barista_id_fkey" FOREIGN KEY ("barista_id") REFERENCES "baristas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
