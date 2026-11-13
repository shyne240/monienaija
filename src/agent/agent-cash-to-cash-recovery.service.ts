import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CashOutInstitutionResolver } from './cash-out-institution.resolver';
import { requireCashOutAgentSession } from './cash-out-intent';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class AgentCashToCashRecoveryService {
  constructor(
    private readonly db: DataSource,
    private readonly institution: CashOutInstitutionResolver,
  ) {}
  async recover(principal: AuthorizationPrincipal, operationKey: string) {
    const { result } = await this.db.transaction((manager) =>
      this.recoverWithManager(manager, principal, operationKey),
    );
    return result;
  }
  async recoverWithManager(
    manager: EntityManager,
    principal: AuthorizationPrincipal,
    operationKey: string,
  ) {
    if (
      principal.type !== 'AGENT' ||
      !principal.agentId ||
      principal.principalId !== principal.agentId ||
      !operationKey.trim() ||
      operationKey.length > 255
    )
      throw new UnauthorizedException('Agent authentication required');
    const agentId = principal.agentId;
    await requireCashOutAgentSession(manager, agentId, principal.sessionId);
    const affiliation = await this.institution.resolve(manager, agentId, { lock: 'SHARE' });
    if (
      affiliation.outcome !== 'RESOLVED' ||
      affiliation.agentId !== agentId ||
      !affiliation.institutionId ||
      !UUID.test(affiliation.institutionId)
    )
      throw new ServiceUnavailableException('Institutional recovery unavailable');
    const rows = await manager.query<
      Array<{
        id: string;
        status: string;
        principal_minor: string;
        currency: string;
        journal_id: string;
        created_at: Date;
        expires_at: Date;
        expired_at: Date | null;
        claim_journal_id: string | null;
        institution_id: string | null;
        funding_valid: boolean;
        lifecycle_valid: boolean;
        transfer_number: string | null;
        sender_phone: string | null;
      }>
    >(
      `SELECT t.id,t.status,t.principal_minor::text,t.currency,t.journal_id,t.created_at,t.expires_at,t.expired_at,t.claim_journal_id,f.institution_id,l.transfer_number,l.sender_phone,
      (f.transfer_id IS NOT NULL AND f.funding_agent_id=t.agent_id AND f.funding_journal_id=t.journal_id AND EXISTS(SELECT 1 FROM ledger_lines x WHERE x.journal_id=t.journal_id AND x.ledger_account_id=f.funding_ledger_account_id AND x.direction='DEBIT' AND x.amount_minor=t.total_minor AND x.currency=t.currency) AND EXISTS(SELECT 1 FROM ledger_lines x WHERE x.journal_id=t.journal_id AND x.ledger_account_id=f.unclaimed_ledger_account_id AND x.direction='CREDIT' AND x.amount_minor=t.principal_minor AND x.currency=t.currency)) AS funding_valid,
      CASE WHEN t.status='CLAIMED' THEN t.claimed_at IS NOT NULL AND t.claim_journal_id IS NOT NULL AND EXISTS (SELECT 1 FROM ledger_lines x WHERE x.journal_id=t.claim_journal_id AND x.ledger_account_id=f.unclaimed_ledger_account_id AND x.direction='DEBIT' AND x.amount_minor=t.principal_minor AND x.currency=t.currency) AND EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type='AGENT_CASH_TO_CASH_CLAIM' AND a.action='CASH_TO_CASH_CLAIMED' AND a.entity_id=t.claim_journal_id AND a.new_values->>'transferId'=t.id::text AND a.new_values->>'requestHash' ~ '^[0-9a-f]{64}$') WHEN t.status='CANCELLED' THEN EXISTS (SELECT 1 FROM cash_to_cash_cancellations c WHERE c.transfer_id=t.id AND c.agent_id=t.agent_id) AND t.claim_journal_id IS NULL WHEN t.status='EXPIRED' THEN t.expired_at IS NOT NULL AND t.claim_journal_id IS NULL WHEN t.status='UNCLAIMED' THEN t.claim_journal_id IS NULL ELSE FALSE END AS lifecycle_valid
      FROM cash_to_cash_transfers t LEFT JOIN cash_to_cash_funding_evidence f ON f.transfer_id=t.id LEFT JOIN cash_to_cash_locators l ON l.transfer_id=t.id WHERE t.agent_id=$1 AND t.idempotency_key=$2`,
      [agentId, operationKey.trim()],
    );
    const row = rows[0];
    if (!row)
      return { institutionId: affiliation.institutionId, result: { status: 'UNKNOWN' as const } };
    if (row.institution_id && row.institution_id !== affiliation.institutionId)
      throw new ConflictException('Institutional recovery unavailable');
    if (!row.institution_id)
      return {
        institutionId: affiliation.institutionId,
        result: { status: 'EVIDENCE_REVIEW' as const },
      };
    if (!row.funding_valid || !row.lifecycle_valid)
      return {
        institutionId: affiliation.institutionId,
        result: { status: 'EVIDENCE_REVIEW' as const, transferId: row.id },
      };
    return {
      institutionId: affiliation.institutionId,
      result: {
        status: 'FOUND' as const,
        transferId: row.id,
        lifecycleStatus: row.status,
        principalMinor: row.principal_minor,
        currency: row.currency,
        journalId: row.journal_id,
        claimJournalId: row.claim_journal_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        expiredAt: row.expired_at,
        senderPhone: row.sender_phone,
        transferNumber: row.transfer_number,
        disposition:
          row.status === 'CANCELLED' || row.status === 'EXPIRED' ? ('PENDING' as const) : null,
      },
    };
  }
}
