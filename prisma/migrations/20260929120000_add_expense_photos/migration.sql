-- CreateTable
CREATE TABLE "expense_photos" (
    "id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_photos_expense_id_idx" ON "expense_photos"("expense_id");

-- AddForeignKey
ALTER TABLE "expense_photos" ADD CONSTRAINT "expense_photos_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
