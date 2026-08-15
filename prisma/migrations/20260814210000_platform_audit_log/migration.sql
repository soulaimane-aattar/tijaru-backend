-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'ok',
    "target_type" TEXT NOT NULL DEFAULT 'business',
    "target_id" TEXT,
    "target_name" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

