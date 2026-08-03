import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma.service';
import {
  AdminPolicyRepository,
  type SecurityPolicyPatch,
} from '../domain/admin-policy.repository';

/** Strip keys whose value is `undefined` (exactOptionalPropertyTypes-safe Prisma payloads). */
const compact = <T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

@Injectable()
export class PrismaAdminPolicyRepository extends AdminPolicyRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findPolicyDetail(): Promise<unknown | null> {
    return this.prisma.securityPolicy.findFirst({
      include: { business: { select: { id: true, name: true } } },
    });
  }

  async findPolicyId(): Promise<string | null> {
    const policy = await this.prisma.securityPolicy.findFirst({ select: { id: true } });
    return policy?.id ?? null;
  }

  updatePolicy(id: string, patch: SecurityPolicyPatch): Promise<unknown> {
    return this.prisma.securityPolicy.update({
      where: { id },
      data: compact(patch),
    });
  }
}
