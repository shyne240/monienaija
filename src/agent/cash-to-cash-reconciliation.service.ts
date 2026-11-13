import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { AuditService } from '../operations/audit.service';
import { requireCashOutAgentSession } from './cash-out-intent';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HandoffReason =
  | 'UNKNOWN_OUTCOME'
  | 'RECEIPT_UNAVAILABLE'
  | 'DISPOSITION_PENDING'
  | 'EVIDENCE_REVIEW';
interface Evidence {
  transfer_id: string;
  agent_id: string;
  status: string;
  principal_minor: string;
  currency: string;
  funding_journal_id: string;
  claim_journal_id: string | null;
  created_at: Date;
  expires_at: Date;
  expired_at: Date | null;
  claimed_at: Date | null;
  funding_liability: boolean;
  funding_wallet: boolean;
  claim_liability: boolean;
  claim_receipt: boolean;
  modern_evidence: boolean;
  cancellation_evidence: boolean;
}

/** Read-only classification: uncertainty is never treated as proof of an obligation or settlement. */
function classify(e: Evidence) {
  const funding = e.funding_liability && e.funding_wallet;
  let classification = 'INCOMPLETE_OR_CONFLICTING';
  if (
    funding &&
    e.status === 'CLAIMED' &&
    e.claim_journal_id &&
    e.claimed_at &&
    e.claim_liability &&
    e.claim_receipt
  )
    classification = 'COMPLETED_WITH_EXECUTION_EVIDENCE';
  else if (funding && !e.claim_journal_id && !e.claimed_at) {
    if (e.status === 'UNCLAIMED') classification = 'OUTSTANDING_FUNDED';
    if (e.status === 'EXPIRED' && e.expired_at) classification = 'EXPIRED_DISPOSITION_PENDING';
    if (e.status === 'CANCELLED' && e.cancellation_evidence)
      classification = 'CANCELLED_DISPOSITION_PENDING';
  }
  return {
    ...e,
    classification,
    outstandingLiabilityMinor: [
      'OUTSTANDING_FUNDED',
      'EXPIRED_DISPOSITION_PENDING',
      'CANCELLED_DISPOSITION_PENDING',
    ].includes(classification)
      ? e.principal_minor
      : classification === 'COMPLETED_WITH_EXECUTION_EVIDENCE'
        ? '0'
        : null,
  };
}

@Injectable()
export class CashToCashReconciliationService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}
  private async evidence(manager: EntityManager, transferId: string): Promise<Evidence> {
    const rows = await manager.query<Evidence[]>(
      `SELECT t.id::text AS transfer_id,t.agent_id::text AS agent_id,t.status,t.principal_minor::text,t.currency,t.journal_id::text AS funding_journal_id,t.claim_journal_id::text,t.created_at,t.expires_at,t.expired_at,t.claimed_at,
      EXISTS (SELECT 1 FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.journal_id=t.journal_id AND a.code='CASH_TO_CASH-UNCLAIMED-NGN' AND l.direction='CREDIT' AND l.amount_minor=t.principal_minor AND l.currency=t.currency) AS funding_liability,
      EXISTS (SELECT 1 FROM ledger_lines l JOIN wallet_accounts w ON w.ledger_account_id=l.ledger_account_id WHERE l.journal_id=t.journal_id AND w.customer_id=t.agent_id::text AND w.owner_class='AGENT' AND l.direction='DEBIT' AND l.amount_minor=t.total_minor AND l.currency=t.currency) AS funding_wallet,
      EXISTS (SELECT 1 FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.journal_id=t.claim_journal_id AND a.code='CASH_TO_CASH-UNCLAIMED-NGN' AND l.direction='DEBIT' AND l.amount_minor=t.principal_minor AND l.currency=t.currency) AS claim_liability,
      EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type='AGENT_CASH_TO_CASH_CLAIM' AND a.entity_id=t.claim_journal_id AND a.action='CASH_TO_CASH_CLAIMED' AND a.new_values->>'requestHash' ~ '^[0-9a-f]{64}$' AND a.new_values->>'redemptionMethod' IN ('AGENT_CASH','CUSTOMER_WALLET') AND a.new_values->>'transferId'=t.id::text AND a.new_values->>'journalId'=t.claim_journal_id::text AND a.new_values->>'claimantCustomerId'=t.claimant_customer_id::text AND a.new_values->>'idempotencyKey'=t.claim_idempotency_key AND a.new_values->>'principalMinor'=t.principal_minor::text AND a.new_values->>'currency'=t.currency) AS claim_receipt,
      EXISTS (SELECT 1 FROM cash_to_cash_funding_evidence f WHERE f.transfer_id=t.id AND f.funding_agent_id=t.agent_id AND f.funding_journal_id=t.journal_id) AS modern_evidence,
      EXISTS (SELECT 1 FROM cash_to_cash_cancellations c WHERE c.transfer_id=t.id AND c.agent_id=t.agent_id) AS cancellation_evidence
      FROM cash_to_cash_transfers t WHERE t.id=$1`,
      [transferId],
    );
    if (!rows[0]) throw new NotFoundException('Transfer not found');
    return rows[0];
  }
  async handoff(principal: AuthorizationPrincipal, transferId: string, reason: HandoffReason) {
    if (
      !UUID.test(transferId) ||
      principal.type !== 'AGENT' ||
      !principal.agentId ||
      principal.principalId !== principal.agentId
    )
      throw new UnauthorizedException('Agent authentication required');
    return this.db.transaction(async (manager) => {
      await requireCashOutAgentSession(manager, principal.agentId!, principal.sessionId);
      const locked = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM cash_to_cash_transfers WHERE id=$1 AND agent_id=$2 FOR SHARE`,
        [transferId, principal.agentId],
      );
      if (!locked[0]) throw new NotFoundException('Transfer not found');
      const snapshot = classify(await this.evidence(manager, transferId));
      const id = randomUUID();
      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO cash_to_cash_reconciliation_handoffs(id,transfer_id,agent_id,reason,evidence) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(transfer_id) DO NOTHING RETURNING id`,
        [id, transferId, principal.agentId, reason, JSON.stringify(snapshot)],
      );
      if (inserted[0]) {
        await this.audit.record(manager, {
          entityType: 'CASH_TO_CASH_RECONCILIATION',
          entityId: id,
          action: 'HANDOFF_CREATED',
          actor: `agent:${principal.agentId}`,
          newValues: { transferId, reason },
        });
        return { id };
      }
      const prior = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM cash_to_cash_reconciliation_handoffs WHERE transfer_id=$1`,
        [transferId],
      );
      if (!prior[0]) throw new ConflictException('Handoff unavailable');
      return { id: prior[0].id };
    });
  }
  async lookup(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Handoff not found');
    return this.db.transaction(async (manager) => {
      const rows = await manager.query<Array<{ transfer_id: string; [key: string]: unknown }>>(
        `SELECT id,transfer_id,agent_id,reason,evidence,created_at FROM cash_to_cash_reconciliation_handoffs WHERE id=$1`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Handoff not found');
      return { ...rows[0], current: classify(await this.evidence(manager, rows[0].transfer_id)) };
    });
  }
}
