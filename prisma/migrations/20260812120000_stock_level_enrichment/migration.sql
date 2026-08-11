-- AlterTable
ALTER TABLE "stock_levels" ADD COLUMN "businessId" TEXT;
ALTER TABLE "stock_levels" ADD COLUMN "reservedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_levels" ADD COLUMN "avgCost" DECIMAL(12,4) NOT NULL DEFAULT 0;
ALTER TABLE "stock_levels" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill businessId from the related product
UPDATE "stock_levels" sl SET "businessId" = p."business_id"
FROM "products" p WHERE p.id = sl."productId";

ALTER TABLE "stock_levels" ALTER COLUMN "businessId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "stock_levels_businessId_productId_idx" ON "stock_levels"("businessId", "productId");
