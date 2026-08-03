-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('rent', 'utilities', 'salaries', 'supplies', 'transport', 'maintenance', 'taxes', 'marketing', 'other');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('pending', 'done', 'failed');

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2),
    "category" "ExpenseCategory" NOT NULL DEFAULT 'other',
    "supplier_id" TEXT,
    "merchant_name" TEXT,
    "note" TEXT,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "receipt_path" TEXT,
    "ocr_status" "OcrStatus",
    "ocr_raw" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_business_id_date_idx" ON "expenses"("business_id", "date");

-- CreateIndex
CREATE INDEX "expenses_business_id_category_idx" ON "expenses"("business_id", "category");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
