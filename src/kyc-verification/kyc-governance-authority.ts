import type { EntityManager } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { KycFoundationError } from './kyc.types';

export type KycGovernanceProposalKind = 'PROVIDER' | 'TIER_POLICY';
export type KycGovernanceDecision = 'APPROVED' | 'REJECTED';

/**
 * Append the decision record through the credential-separated authority connection. The database
 * computes a digest from the persisted proposal; no digest, maker, MFA assertion, or expiry is
 * accepted from the caller. Triggers enforce that the proposal is live, current-version, and still
 * REQUESTED. A unique immutable row makes a decision single-use.
 */
export async function appendKycGovernanceDecision(
  manager: EntityManager,
  kind: KycGovernanceProposalKind,
  proposalId: string,
  state: KycGovernanceDecision,
  checker: AuthorizationPrincipal,
): Promise<Date> {
  const table =
    kind === 'PROVIDER' ? 'kyc_provider_change_proposals' : 'kyc_tier_policy_proposals';
  const rows = await manager.query<Array<{ decided_at: Date }>>(
    `INSERT INTO protected_authority.kyc_governance_decisions(
       proposal_schema,proposal_kind,proposal_id,payload_digest,decision,
       maker_principal_id,maker_session_id,checker_principal_id,checker_session_id,
       assurance_level,decided_at,expires_at
     )
     SELECT current_schema(),$2::text,p.id,
       protected_authority.kyc_governance_payload_digest(current_schema(),$2::text,p.id),
       $3,p.maker_id,p.maker_session_id,$4,$5,'MFA',date_trunc('milliseconds',clock_timestamp()),p.expires_at
      FROM ${table} p
      WHERE p.id=$1 AND p.state='REQUESTED'
     RETURNING decided_at`,
    [proposalId, kind, state, checker.principalId, checker.sessionId],
  );
  if (!rows[0] || !(rows[0].decided_at instanceof Date))
    throw new KycFoundationError('CONFLICT');
  return rows[0].decided_at;
}
