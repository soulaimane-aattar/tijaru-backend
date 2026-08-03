-- Tenant columns + scoped uniqueness + BusinessModule.
-- HAND-EDITED for safe backfill: existing rows belong to the single seeded business.
-- For every tenant table we add business_id as NULLABLE, backfill it to the one
-- existing business, then enforce NOT NULL. This preserves all existing data.

-- ─── Drop old global unique indexes ──────────────────────────────────────────
DROP INDEX "categories_name_key";
DROP INDEX "custom_roles_name_key";
DROP INDEX "po_tickets_number_key";
DROP INDEX "products_barcode_key";
DROP INDEX "products_sku_key";
DROP INDEX "purchase_orders_number_key";

-- ─── Add business_id (nullable → backfill → NOT NULL) per tenant table ────────
ALTER TABLE "warehouses" ADD COLUMN "business_id" TEXT;
UPDATE "warehouses" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "warehouses" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "users" ADD COLUMN "business_id" TEXT;
UPDATE "users" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "users" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "custom_roles" ADD COLUMN "business_id" TEXT;
UPDATE "custom_roles" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "custom_roles" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "categories" ADD COLUMN "business_id" TEXT;
UPDATE "categories" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "categories" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "suppliers" ADD COLUMN "business_id" TEXT;
UPDATE "suppliers" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "suppliers" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "customers" ADD COLUMN "business_id" TEXT;
UPDATE "customers" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "customers" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "products" ADD COLUMN "business_id" TEXT;
UPDATE "products" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "products" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "movements" ADD COLUMN "business_id" TEXT;
UPDATE "movements" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "movements" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "purchase_orders" ADD COLUMN "business_id" TEXT;
UPDATE "purchase_orders" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "purchase_orders" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "po_sessions" ADD COLUMN "business_id" TEXT;
UPDATE "po_sessions" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "po_sessions" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "po_tickets" ADD COLUMN "business_id" TEXT;
UPDATE "po_tickets" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "po_tickets" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "inventory_counts" ADD COLUMN "business_id" TEXT;
UPDATE "inventory_counts" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "inventory_counts" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "notifications" ADD COLUMN "business_id" TEXT;
UPDATE "notifications" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "notifications" ALTER COLUMN "business_id" SET NOT NULL;

ALTER TABLE "activities" ADD COLUMN "business_id" TEXT;
UPDATE "activities" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "activities" ALTER COLUMN "business_id" SET NOT NULL;

-- ─── role_customizations: change PK to include business_id ───────────────────
ALTER TABLE "role_customizations" DROP CONSTRAINT "role_customizations_pkey";
ALTER TABLE "role_customizations" ADD COLUMN "business_id" TEXT;
UPDATE "role_customizations" SET "business_id" = (SELECT "id" FROM "businesses" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "role_customizations" ALTER COLUMN "business_id" SET NOT NULL;
ALTER TABLE "role_customizations" ADD CONSTRAINT "role_customizations_pkey" PRIMARY KEY ("business_id", "role", "capId");

-- ─── business_modules (new table, no backfill) ───────────────────────────────
CREATE TABLE "business_modules" (
    "business_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_modules_pkey" PRIMARY KEY ("business_id","module_id")
);

-- ─── Indexes (business_id + scoped uniques) ──────────────────────────────────
CREATE INDEX "activities_business_id_idx" ON "activities"("business_id");
CREATE INDEX "categories_business_id_idx" ON "categories"("business_id");
CREATE UNIQUE INDEX "categories_business_id_name_key" ON "categories"("business_id", "name");
CREATE INDEX "custom_roles_business_id_idx" ON "custom_roles"("business_id");
CREATE UNIQUE INDEX "custom_roles_business_id_name_key" ON "custom_roles"("business_id", "name");
CREATE INDEX "customers_business_id_idx" ON "customers"("business_id");
CREATE INDEX "inventory_counts_business_id_idx" ON "inventory_counts"("business_id");
CREATE INDEX "movements_business_id_idx" ON "movements"("business_id");
CREATE INDEX "notifications_business_id_idx" ON "notifications"("business_id");
CREATE INDEX "po_sessions_business_id_idx" ON "po_sessions"("business_id");
CREATE INDEX "po_tickets_business_id_idx" ON "po_tickets"("business_id");
CREATE UNIQUE INDEX "po_tickets_business_id_number_key" ON "po_tickets"("business_id", "number");
CREATE INDEX "products_business_id_idx" ON "products"("business_id");
CREATE UNIQUE INDEX "products_business_id_barcode_key" ON "products"("business_id", "barcode");
CREATE UNIQUE INDEX "products_business_id_sku_key" ON "products"("business_id", "sku");
CREATE INDEX "purchase_orders_business_id_idx" ON "purchase_orders"("business_id");
CREATE UNIQUE INDEX "purchase_orders_business_id_number_key" ON "purchase_orders"("business_id", "number");
CREATE INDEX "suppliers_business_id_idx" ON "suppliers"("business_id");
CREATE INDEX "users_business_id_idx" ON "users"("business_id");
CREATE INDEX "warehouses_business_id_idx" ON "warehouses"("business_id");

-- ─── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_customizations" ADD CONSTRAINT "role_customizations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "movements" ADD CONSTRAINT "movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "po_sessions" ADD CONSTRAINT "po_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "po_tickets" ADD CONSTRAINT "po_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_modules" ADD CONSTRAINT "business_modules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
