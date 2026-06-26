import { z } from 'zod';

import { VAT_RATES } from '../../../domain/value-objects/vat-rate';

const UnitEnum = z.enum(['piece', 'kg', 'g', 'litre', 'ml', 'carton', 'pack']);
const VatEnum = z.union([z.literal(0), z.literal(7), z.literal(10), z.literal(14), z.literal(20)]);

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Tone must be a #RRGGBB hex color');

const ean13 = z
  .string()
  .regex(/^\d{13}$/, 'Barcode must be 13 digits (EAN-13)')
  .refine((d) => {
    const nums = d.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += nums[i]! * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10 === nums[12];
  }, 'Invalid EAN-13 checksum');

export const StockEntrySchema = z.object({
  warehouseId: z.string().cuid(),
  qty: z.number().int().min(0),
});

export const CreateProductSchema = z.object({
  name: z.string().min(1).max(160),
  barcode: ean13,
  sku: z.string().min(1).max(40),
  categoryId: z.string().cuid(),
  purchase: z.number().min(0),
  sale: z.number().min(0),
  vat: VatEnum,
  unit: UnitEnum.default('piece'),
  supplierId: z.string().cuid().optional(),
  trackExpiry: z.boolean().default(false),
  expiry: z.coerce.date().optional(),
  batch: z.string().optional(),
  minStock: z.number().int().min(0).default(0),
  maxStock: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  tone: HexColor.default('#94a3b8'),
  stock: z.array(StockEntrySchema).default([]),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.partial();
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const ListProductsQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().cuid().optional(),
  supplierId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  lowStock: z.coerce.boolean().optional(),
  outOfStock: z.coerce.boolean().optional(),
  expiringDays: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['name', 'createdAt', 'updatedAt', 'sale']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

// Runtime export for downstream consumers
export { VAT_RATES };
