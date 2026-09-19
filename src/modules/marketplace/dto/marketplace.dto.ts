import { z } from 'zod';

export const UnitSchema = z.enum(['piece', 'kg', 'g', 'litre', 'ml', 'carton', 'pack']);

// ─── Price groups ────────────────────────────────────────────────────────────

export const PriceGroupSchema = z.object({
  name: z.string().min(1).max(60),
  isDefault: z.boolean().default(false),
});
export type PriceGroupInput = z.infer<typeof PriceGroupSchema>;

export const UpdatePriceGroupSchema = PriceGroupSchema.partial();
export type UpdatePriceGroupInput = z.infer<typeof UpdatePriceGroupSchema>;

// ─── Listings ────────────────────────────────────────────────────────────────

export const TierSchema = z.object({
  priceGroupId: z.string().cuid().nullable().default(null),
  minQty: z.number().int().min(1),
  unitPrice: z.number().min(0),
});
export type TierInput = z.infer<typeof TierSchema>;

export const CreateListingSchema = z.object({
  productId: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  unitPrice: z.number().min(0).optional(),
  vat: z.number().int().min(0).max(100).optional(),
  minOrderQty: z.number().int().min(1).default(1),
  active: z.boolean().default(true),
  tiers: z.array(TierSchema).max(20).default([]),
});
export type CreateListingInput = z.infer<typeof CreateListingSchema>;

export const UpdateListingSchema = CreateListingSchema.omit({ productId: true }).partial();
export type UpdateListingInput = z.infer<typeof UpdateListingSchema>;

export const ReplaceTiersSchema = z.object({ tiers: z.array(TierSchema).max(20) });
export type ReplaceTiersInput = z.infer<typeof ReplaceTiersSchema>;

// ─── Catalog (buyer side) ────────────────────────────────────────────────────

export const CatalogQuerySchema = z.object({
  q: z.string().max(120).optional(),
  sellerId: z.string().cuid().optional(),
  qty: z.coerce.number().int().min(1).default(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;
