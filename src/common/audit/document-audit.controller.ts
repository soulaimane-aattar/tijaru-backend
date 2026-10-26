import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../decorators/require-cap.decorator';
import { TenantContext } from '../tenant/tenant-context';

import { DocumentAuditService, type AuditRow, type DocType } from './document-audit.service';

const VALID_DOC_TYPES = new Set(['invoice', 'delivery_note', 'estimate', 'purchase_order']);

@ApiTags('document-audits')
@ApiBearerAuth()
@Controller({ path: 'document-audits', version: '1' })
export class DocumentAuditController {
  constructor(
    private readonly audit: DocumentAuditService,
    private readonly tenant: TenantContext,
  ) {}

  @Get(':docType/:docId')
  @RequireCap('billing.manage')
  async history(
    @Param('docType') docType: string,
    @Param('docId') docId: string,
  ): Promise<AuditRow[]> {
    if (!VALID_DOC_TYPES.has(docType)) return [];
    const businessId = this.tenant.getBusinessId();
    if (!businessId) throw new Error('missing tenant');
    return this.audit.history(businessId, docType as DocType, docId);
  }
}
