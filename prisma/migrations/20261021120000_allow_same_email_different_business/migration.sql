-- DropIndex
DROP INDEX IF EXISTS "users_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_email_business_id_key" ON "users"("email", "business_id");
