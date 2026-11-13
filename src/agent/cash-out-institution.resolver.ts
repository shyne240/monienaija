import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Integration seam for Arena 4's authoritative institution membership resolver.
 * The current schema only permits a transitional fixture scope; never infer membership
 * from an agent, aggregator, request payload, environment flag or existing intent. */
@Injectable()
export class CashOutInstitutionResolver {
  resolve(_manager: EntityManager, _agentId: string, _customerId: string): Promise<string> {
    void _manager;
    void _agentId;
    void _customerId;
    return Promise.reject(new ServiceUnavailableException('Institution authorization unavailable'));
  }
}
