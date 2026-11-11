import type { EntityManager } from 'typeorm';
import type { TierEvidence } from './kyc-tier-decision';
export interface TierEvidenceSnapshot {
  identityRevision: string;
  evidence: TierEvidence[];
}
/** No provider is confirmed for live use. An unavailable adapter is not an empty evidence set. */
export class KycTierEvidenceReader {
  read(_manager: EntityManager, _customerId: string): Promise<TierEvidenceSnapshot | null> {
    void _manager;
    void _customerId;
    return Promise.resolve(null);
  }
}
