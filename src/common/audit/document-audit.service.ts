
import { Injectable } from '@nestjs/common';

import { Db } from '../../database';
import { newId } from '../../database/ids';

export type DocType = 'invoice' | 'delivery_note' | 'estimate' | 'purchase_order';
export type AuditAction = 'create' | 'update' | 'cancel' | 'status_change' | 'sign' | 'payment';

export interface AuditEntry {
  businessId: string;
  docType: DocType;
  docId: string;
  docNumber: string;
  action: AuditAction;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  userId: string;
  userName: string;
}

export interface AuditRow {
  id: string;
  docType: string;
  docId: string;
  docNumber: string;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  userId: string;
  userName: string;
  createdAt: Date;
}

@Injectable()
export class DocumentAuditService {
  constructor(private readonly db: Db) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.q
      .insertInto('app.document_audits')
      .values({
        id: newId(),
        business_id: entry.businessId,
        doc_type: entry.docType,
        doc_id: entry.docId,
        doc_number: entry.docNumber,
        action: entry.action,
        user_id: entry.userId,
        user_name: entry.userName,
        changes: entry.changes ? JSON.stringify(entry.changes) : null,
      })
      .execute();
  }

  async history(businessId: string, docType: DocType, docId: string): Promise<AuditRow[]> {
    const rows = await this.db.q
      .selectFrom('app.document_audits')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('doc_type', '=', docType)
      .where('doc_id', '=', docId)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      docType: r.doc_type,
      docId: r.doc_id,
      docNumber: r.doc_number,
      action: r.action,
      changes: r.changes as AuditRow['changes'],
      userId: r.user_id,
      userName: r.user_name,
      createdAt: r.created_at,
    }));
  }
}
