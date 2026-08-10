-- CreateEnum
CREATE TYPE "DeliveryNoteType" AS ENUM ('order', 'out', 'in_');
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('prepared', 'sent', 'shipped', 'partial', 'delivered', 'closed');

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "DeliveryNoteType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'prepared',
    "customer_id" TEXT,
    "supplier_id" TEXT,
    "issued_by_id" TEXT NOT NULL,
    "source_ref" TEXT,
    "carrier" TEXT,
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signed_at" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_note_lines" (
    "id" TEXT NOT NULL,
    "delivery_note_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ordered" DECIMAL(12,3) NOT NULL,
    "sent" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_business_id_number_key" ON "delivery_notes"("business_id", "number");
CREATE INDEX "delivery_notes_business_id_date_idx" ON "delivery_notes"("business_id", "date");
CREATE INDEX "delivery_notes_business_id_type_idx" ON "delivery_notes"("business_id", "type");
CREATE INDEX "delivery_notes_business_id_status_idx" ON "delivery_notes"("business_id", "status");
CREATE INDEX "delivery_note_lines_delivery_note_id_idx" ON "delivery_note_lines"("delivery_note_id");

-- FK
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
