import type { InvoiceStatus } from '../dto/invoices.dto';

export interface InvoiceLineData {
  productId: string;
  label: string;
  qty: number;
  priceHt: number;
  vat: number;
  discount: number;
}

export interface InvoiceCreateData {
  businessId: string;
  number: string;
  date: Date;
  dueDate: Date;
  customerId: string;
  issuedById: string;
  status: InvoiceStatus;
  ht: number;
  tva: number;
  discount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  lines: InvoiceLineData[];
}

export interface InvoiceRow {
  id: string;
  number: string;
  date: Date;
  dueDate: Date;
  customerId: string;
  customerName: string;
  status: InvoiceStatus;
  ht: number;
  tva: number;
  discount: number;
  total: number;
  paid: number;
}

export interface InvoiceDetail extends InvoiceRow {
  issuedById: string;
  issuedByName: string;
  notes: string | null;
  terms: string | null;
  lines: (InvoiceLineData & { id: string })[];
}

export interface ListParams {
  businessId: string;
  status?: InvoiceStatus;
  customerId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface ListResult {
  items: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
}

export abstract class InvoicesRepository {
  abstract findLastNumber(businessId: string, prefix: string): Promise<string | null>;
  abstract create(data: InvoiceCreateData): Promise<InvoiceDetail>;
  abstract findDetail(businessId: string, id: string): Promise<InvoiceDetail | null>;
  abstract list(params: ListParams): Promise<ListResult>;
  abstract updateStatus(id: string, status: InvoiceStatus): Promise<void>;
  abstract addPayment(id: string, amount: number): Promise<InvoiceDetail>;
}
