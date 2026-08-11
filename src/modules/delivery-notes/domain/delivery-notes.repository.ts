import type { DeliveryNoteStatus, DeliveryNoteType } from '../dto/delivery-notes.dto';

export interface DeliveryLineData {
  productId: string;
  label: string;
  ordered: number;
  sent: number;
  unitPrice: number;
}

export interface DeliveryLineRow extends DeliveryLineData {
  id: string;
}

export interface DeliveryCreateData {
  businessId: string;
  number: string;
  type: DeliveryNoteType;
  date: Date;
  status: DeliveryNoteStatus;
  customerId: string | null;
  supplierId: string | null;
  issuedById: string;
  sourceRef: string | null;
  carrier: string | null;
  notes: string | null;
  lines: DeliveryLineData[];
}

export interface DeliveryRow {
  id: string;
  number: string;
  type: DeliveryNoteType;
  date: Date;
  status: DeliveryNoteStatus;
  partyName: string;
  sourceRef: string | null;
  carrier: string | null;
  signed: boolean;
  ordered: number;
  sent: number;
}

export interface DeliveryDetail extends Omit<DeliveryRow, 'partyName' | 'ordered' | 'sent'> {
  customerId: string | null;
  customerName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  issuedById: string;
  issuedByName: string;
  notes: string | null;
  lines: DeliveryLineRow[];
}

export interface ListParams {
  businessId: string;
  type?: DeliveryNoteType;
  status?: DeliveryNoteStatus;
  partyId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface ListResult {
  items: DeliveryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export abstract class DeliveryNotesRepository {
  abstract findLastNumber(businessId: string, prefix: string): Promise<string | null>;
  abstract create(data: DeliveryCreateData): Promise<DeliveryDetail>;
  abstract findDetail(businessId: string, id: string): Promise<DeliveryDetail | null>;
  abstract list(params: ListParams): Promise<ListResult>;
  abstract updateStatus(id: string, status: DeliveryNoteStatus): Promise<void>;
  abstract updateLineSent(lineId: string, sent: number): Promise<void>;
  abstract markSigned(id: string, when: Date): Promise<void>;
}

/**
 * Port: read-only product price lookup used to prefill a line's `unitPrice`
 * when the caller omits it. Scoped to delivery-notes (not the products
 * module's own `ProductsRepository`, which isn't exported for cross-module
 * injection and has no price-oriented accessor).
 */
export abstract class ProductPriceLookup {
  abstract findById(
    businessId: string,
    productId: string,
  ): Promise<{ id: string; price: number | string } | null>;
}
