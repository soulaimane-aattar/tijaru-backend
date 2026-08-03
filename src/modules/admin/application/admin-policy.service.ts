import { Injectable } from '@nestjs/common';

import { DomainError } from '../../../common/errors';
import { AdminPolicyRepository } from '../domain/admin-policy.repository';
import type { PatchSecurityPolicyInput } from '../dto/admin.dto';

@Injectable()
export class AdminPolicyService {
  constructor(private readonly policies: AdminPolicyRepository) {}

  async get(): Promise<unknown> {
    const policy = await this.policies.findPolicyDetail();
    if (!policy) {
      throw new DomainError('not_found', 'Security policy not configured', 404);
    }
    return policy;
  }

  async patch(input: PatchSecurityPolicyInput): Promise<unknown> {
    const policyId = await this.policies.findPolicyId();
    if (!policyId) throw new DomainError('not_found', 'Security policy not configured', 404);

    return this.policies.updatePolicy(policyId, input);
  }
}
