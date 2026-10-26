-- CreateTable
CREATE TABLE "document_audits" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_audits_business_id_doc_type_doc_id_idx" ON "document_audits"("business_id", "doc_type", "doc_id");

-- CreateIndex
CREATE INDEX "document_audits_business_id_created_at_idx" ON "document_audits"("business_id", "created_at");

-- AlterEnum
ALTER TYPE "DeliveryNoteStatus" ADD VALUE IF NOT EXISTS 'cancelled';
