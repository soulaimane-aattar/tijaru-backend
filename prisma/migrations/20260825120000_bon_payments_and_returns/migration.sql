-- CreateEnum
CREATE TYPE "BonPaymentMethod" AS ENUM ('cash', 'card', 'transfer', 'other');

-- AlterEnum
ALTER TYPE "DeliveryNoteType" ADD VALUE 'retour';

-- AlterEnum
ALTER TYPE "MovementReason" ADD VALUE 'retour';

-- AlterTable
ALTER TABLE "delivery_notes" ADD COLUMN     "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "return_of_id" TEXT;

-- CreateTable
CREATE TABLE "delivery_note_payments" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "delivery_note_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "BonPaymentMethod" NOT NULL DEFAULT 'cash',
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_note_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_note_payments_delivery_note_id_idx" ON "delivery_note_payments"("delivery_note_id");

-- CreateIndex
CREATE INDEX "delivery_note_payments_business_id_createdAt_idx" ON "delivery_note_payments"("business_id", "createdAt");

-- CreateIndex
CREATE INDEX "delivery_notes_customer_id_idx" ON "delivery_notes"("customer_id");

-- CreateIndex
CREATE INDEX "delivery_notes_return_of_id_idx" ON "delivery_notes"("return_of_id");

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_return_of_id_fkey" FOREIGN KEY ("return_of_id") REFERENCES "delivery_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_payments" ADD CONSTRAINT "delivery_note_payments_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_payments" ADD CONSTRAINT "delivery_note_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
