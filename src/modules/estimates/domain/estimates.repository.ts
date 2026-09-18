import type { EstimateStatus } from '../dto/estimates.dto';

export interface EstimateLineData {
  productId: string;
  label: string;
  qty: number;
  priceHt: number;
  vat: number;
  discount: number;
}

export interface EstimateCreateData {
  businessId: string;
  number: string;
  date: Date;
  validUntil: Date;
  customerId: string;
  issuedById: string;
  ht: number;
  tva: number;
  discount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  lines: EstimateLineData[];
}

export interface EstimateRow {
  id: string;
  number: string;
  date: Date;
  validUntil: Date;
  customerId: string;
  customerName: string;
  status: EstimateStatus;
  total: number;
}

export interface EstimateDetail extends EstimateRow {
  issuedById: string;
  issuedByName: string;
  ht: number;
  tva: number;
  discount: number;
  notes: string | null;
  terms: string | null;
  lines: (EstimateLineData & { id: string; subtotal: number })[];
}

export interface ListParams {
  businessId: string;
  status?: EstimateStatus;
  customerId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface ListResult {
  items: EstimateRow[];
  total: number;
  page: number;
  pageSize: number;
}

export abstract class EstimatesRepository {
  abstract findLastNumber(businessId: string, prefix: string): Promise<string | null>;
  abstract create(data: EstimateCreateData): Promise<EstimateDetail>;
  abstract findDetail(businessId: string, id: string): Promise<EstimateDetail | null>;
  abstract list(params: ListParams): Promise<ListResult>;
  abstract update(id: string, data: Partial<EstimateCreateData> & { status?: EstimateStatus }): Promise<EstimateDetail>;
  abstract remove(id: string): Promise<void>;
}
