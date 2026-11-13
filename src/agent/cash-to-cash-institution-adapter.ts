import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { canonical, sha256 } from '../authorization/workforce-crypto';
import type { ClaimFinancialContextRequest } from './cash-to-cash-claim-authorization';

/** Structural subset of Arena 4 FINANCIAL_CONTEXT_RESOLVER. */
export interface CashToCashInstitutionPort {
  resolve(
    manager: EntityManager,
    request: {
      institutionId?: string;
      agentId?: string;
      customerId?: string;
      walletIds?: string[];
      ledgerAccountIds?: string[];
      lock?: 'SHARE' | 'NONE';
    },
  ): Promise<{
    outcome: 'RESOLVED' | 'UNRESOLVED' | 'NOT_CONFIGURED' | 'INSTITUTION_INACTIVE' | 'INCOMPATIBLE';
    institutionId: string | null;
    evidenceFingerprint: string;
  }>;
}

/**
 * Explicit adapter for the institution foundation, not registered in production.
 * The foundation and its schema must be integrated by the owning team first.
 * Both agents are separately resolved because the published contract accepts only one.
 */
export class CashToCashInstitutionAdapter {
  constructor(private readonly resolver: CashToCashInstitutionPort) {}

  async resolve(
    manager: EntityManager,
    request: ClaimFinancialContextRequest,
  ): Promise<{ institutionId: string; evidenceFingerprint: string }> {
    const claimant = await this.resolver.resolve(manager, {
      agentId: request.agentId,
      customerId: request.customerId,
      walletIds: request.walletIds,
      ledgerAccountIds: request.ledgerAccountIds,
      lock: 'SHARE',
    });
    const institutionId = this.requireResolved(claimant);
    const funder = await this.resolver.resolve(manager, {
      institutionId,
      agentId: request.fundingAgentId,
      lock: 'SHARE',
    });
    const fundingInstitutionId = this.requireResolved(funder);
    if (institutionId !== fundingInstitutionId)
      throw new ConflictException('Institutional financial context is incompatible');
    return {
      institutionId,
      evidenceFingerprint: sha256(
        canonical({ claimant: claimant.evidenceFingerprint, funder: funder.evidenceFingerprint }),
      ),
    };
  }

  private requireResolved(
    result: Awaited<ReturnType<CashToCashInstitutionPort['resolve']>>,
  ): string {
    if (result.outcome === 'INCOMPATIBLE')
      throw new ConflictException('Institutional financial context is incompatible');
    if (
      result.outcome !== 'RESOLVED' ||
      !result.institutionId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        result.institutionId,
      ) ||
      !/^[0-9a-f]{64}$/.test(result.evidenceFingerprint)
    ) {
      throw new ServiceUnavailableException('Institutional financial context unavailable');
    }
    return result.institutionId;
  }
}
