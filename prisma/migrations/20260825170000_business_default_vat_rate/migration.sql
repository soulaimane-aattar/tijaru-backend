-- Per-business default VAT rate (pre-selected on new products/documents).
ALTER TABLE "businesses" ADD COLUMN "default_vat_rate" INTEGER NOT NULL DEFAULT 20;
