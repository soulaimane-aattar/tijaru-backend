-- Category active flag
ALTER TABLE "categories" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Per-business VAT rate configuration
ALTER TABLE "businesses" ADD COLUMN "enabled_vat_rates" INTEGER[] NOT NULL DEFAULT ARRAY[0, 7, 10, 14, 20]::INTEGER[];
