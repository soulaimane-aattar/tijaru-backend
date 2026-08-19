-- Expense categories become per-tenant configurable rows.
-- Historical expenses keep their enum-string value under Expense.category.

-- 1) Create the new config table.
CREATE TABLE "expense_category_defs" (
  "id"          TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "tax_rate"    DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "archived"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_category_defs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_category_defs_business_id_key_key"
  ON "expense_category_defs"("business_id", "key");

CREATE INDEX "expense_category_defs_business_id_archived_sort_order_idx"
  ON "expense_category_defs"("business_id", "archived", "sort_order");

ALTER TABLE "expense_category_defs"
  ADD CONSTRAINT "expense_category_defs_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Seed 9 default categories for every existing business.
--    Order chosen to match the historical enum layout.
INSERT INTO "expense_category_defs" ("id", "business_id", "key", "label", "tax_rate", "sort_order", "created_at", "updated_at")
SELECT
  'seed_' || b.id || '_' || d.key,
  b.id,
  d.key,
  d.label,
  d.tax_rate,
  d.sort_order,
  NOW(),
  NOW()
FROM "businesses" b
CROSS JOIN (VALUES
  ('rent',        'Loyer',       20.00, 10),
  ('utilities',   'Charges',     20.00, 20),
  ('salaries',    'Salaires',     0.00, 30),
  ('supplies',    'Fournitures', 20.00, 40),
  ('transport',   'Transport',   14.00, 50),
  ('maintenance', 'Entretien',   20.00, 60),
  ('taxes',       'Taxes',        0.00, 70),
  ('marketing',   'Marketing',   20.00, 80),
  ('other',       'Autre',        0.00, 90)
) AS d(key, label, tax_rate, sort_order)
ON CONFLICT ("business_id", "key") DO NOTHING;

-- 3) Change Expense.category from enum to text (values preserved as strings).
ALTER TABLE "expenses" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "expenses" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "expenses" ALTER COLUMN "category" SET DEFAULT 'other';

-- 4) Drop the now-unused enum.
DROP TYPE "ExpenseCategory";
