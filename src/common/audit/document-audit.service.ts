import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    const data: Prisma.DocumentAuditCreateInput = {
      businessId: entry.businessId,
      docType: entry.docType,
      docId: entry.docId,
      docNumber: entry.docNumber,
      action: entry.action,
      userId: entry.userId,
      userName: entry.userName,
    };
    if (entry.changes) {
      data.changes = entry.changes as Prisma.InputJsonValue;
    }
    await this.prisma.documentAudit.create({ data });
  }

  async history(businessId: string, docType: DocType, docId: string): Promise<AuditRow[]> {
    const rows = await this.prisma.documentAudit.findMany({
      where: { businessId, docType, docId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r: typeof rows[number]) => ({
      id: r.id,
      docType: r.docType,
      docId: r.docId,
      docNumber: r.docNumber,
      action: r.action,
      changes: r.changes as AuditRow['changes'],
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }
}
