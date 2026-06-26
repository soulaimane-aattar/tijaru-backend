import { Injectable } from '@nestjs/common';

import { DomainError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import type { PatchSecurityPolicyInput } from '../dto/admin.dto';

@Injectable()
export class AdminPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<unknown> {
    const policy = await this.prisma.securityPolicy.findFirst({
      include: { business: { select: { id: true, name: true } } },
    });
    if (!policy) {
      throw new DomainError('not_found', 'Security policy not configured', 404);
    }
    return policy;
  }

  async patch(input: PatchSecurityPolicyInput): Promise<unknown> {
    const policy = await this.prisma.securityPolicy.findFirst();
    if (!policy) throw new DomainError('not_found', 'Security policy not configured', 404);

    const data: Record<string, unknown> = {};
    for (const k of [
      'passwordMinLen',
      'requireUpper',
      'requireDigit',
      'requireSymbol',
      'passwordExpiryDays',
      'passwordHistoryCount',
      'twoFARequiredFor',
      'lockAfterFailures',
      'sessionTimeoutMin',
      'ipAllowlist',
      'auditRetentionDays',
    ] as const) {
      const v = input[k];
      if (v !== undefined) data[k] = v;
    }

    return this.prisma.securityPolicy.update({
      where: { id: policy.id },
      data,
    });
  }
}
