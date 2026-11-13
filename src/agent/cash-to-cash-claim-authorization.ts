import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import { requireCashOutAgentSession } from './cash-out-intent';
import {
  reserveCashOutOtpIssuance,
  cashOutOtpVerificationBudget,
  recordCashOutOtpFailure,
} from './cash-out-otp-budget';
import type { AgentCashToCashRedemptionMethod } from './agent-cash-to-cash-claim.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ClaimFinancialContextRequest {
  agentId: string;
  fundingAgentId: string;
  customerId: string;
  transferId: string;
  fundingJournalId: string;
  redemptionMethod: AgentCashToCashRedemptionMethod;
  walletIds: string[];
  ledgerAccountIds: string[];
  lock: 'SHARE';
}
/** Production has no trusted context implementation. Arena 3 must wire Arena 4's contract. */
@Injectable()
export class CashToCashClaimFinancialContext {
  resolve(
    _manager: EntityManager,
    _request: ClaimFinancialContextRequest,
  ): Promise<{ institutionId: string; evidenceFingerprint: string }> {
    void _manager;
    void _request;
    throw new ServiceUnavailableException('Cash-to-cash institutional authorization unavailable');
  }
}

export interface ClaimBindingInput {
  challengeId: string;
  transferId: string;
  customerId: string;
  agentId: string;
  agentSessionId: string;
  redemptionMethod: AgentCashToCashRedemptionMethod;
  destinationHash: string;
}

/** Locks persisted transfer and current verified recipient evidence; never trusts request amount or institution. */
async function context(
  manager: EntityManager,
  authority: CashToCashClaimFinancialContext,
  input: ClaimBindingInput,
) {
  if (
    ![
      input.challengeId,
      input.transferId,
      input.customerId,
      input.agentId,
      input.agentSessionId,
    ].every((x) => typeof x === 'string' && UUID.test(x)) ||
    !['AGENT_CASH', 'CUSTOMER_WALLET'].includes(input.redemptionMethod) ||
    !/^[0-9a-f]{64}$/.test(input.destinationHash)
  )
    throw new BadRequestException('Cash-to-cash claim context required');
  const rows = await manager.query<
    Array<{
      beneficiary_phone: string;
      principal_minor: string;
      currency: string;
      journal_id: string;
      agent_id: string;
    }>
  >(
    `SELECT beneficiary_phone,principal_minor::text,currency,journal_id,agent_id FROM cash_to_cash_transfers WHERE id=$1 AND status='UNCLAIMED' AND expires_at>clock_timestamp() FOR UPDATE`,
    [input.transferId],
  );
  const transfer = rows[0];
  if (!transfer) throw new ConflictException('Claim transfer unavailable');
  await requireCashOutAgentSession(manager, input.agentId, input.agentSessionId);
  const contacts = await manager.query<Array<{ value: string }>>(
    `SELECT value FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND verified_at IS NOT NULL AND deleted_at IS NULL FOR SHARE`,
    [input.customerId],
  );
  if (
    !contacts[0] ||
    AgentReceivingNumberService.canonicalizeTo10(contacts[0].value) !== transfer.beneficiary_phone
  )
    throw new BadRequestException('Claim recipient unavailable');
  const { createHash } = await import('node:crypto');
  if (createHash('sha256').update(contacts[0].value).digest('hex') !== input.destinationHash)
    throw new ConflictException('Claim destination changed');
  const wallets = await manager.query<Array<{ id: string; ledger_account_id: string }>>(
    `SELECT id,ledger_account_id FROM wallet_accounts WHERE customer_id=$1 AND currency=$2 AND status='ACTIVE' AND owner_class=$3 FOR SHARE`,
    [
      input.redemptionMethod === 'AGENT_CASH' ? input.agentId : input.customerId,
      transfer.currency,
      input.redemptionMethod === 'AGENT_CASH' ? 'AGENT' : 'CUSTOMER',
    ],
  );
  const funding = await manager.query<
    Array<{
      ledger_account_id: string;
      wallet_id: string | null;
      direction: string;
      amount_minor: string;
      currency: string;
    }>
  >(
    `SELECT l.ledger_account_id,w.id AS wallet_id,l.direction,l.amount_minor::text,l.currency FROM ledger_lines l LEFT JOIN wallet_accounts w ON w.ledger_account_id=l.ledger_account_id WHERE l.journal_id=$1`,
    [transfer.journal_id],
  );
  const unclaimed = await manager.query<Array<{ id: string }>>(
    `SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' AND is_active=TRUE FOR SHARE`,
  );
  if (
    wallets.length !== 1 ||
    funding.length < 2 ||
    unclaimed.length !== 1 ||
    !funding.some(
      (line) =>
        line.ledger_account_id === unclaimed[0]?.id &&
        line.direction === 'CREDIT' &&
        line.amount_minor === transfer.principal_minor &&
        line.currency === transfer.currency,
    )
  )
    throw new ConflictException('Claim financial evidence unavailable');
  const walletIds = [
    ...new Set([
      wallets[0]!.id,
      ...funding.flatMap((row) => (row.wallet_id ? [row.wallet_id] : [])),
    ]),
  ].sort();
  const ledgerAccountIds = [
    ...new Set([
      wallets[0]!.ledger_account_id,
      unclaimed[0]!.id,
      ...funding.map((row) => row.ledger_account_id),
    ]),
  ].sort();
  const resolved = await authority.resolve(manager, {
    walletIds,
    ledgerAccountIds,
    agentId: input.agentId,
    fundingAgentId: transfer.agent_id,
    customerId: input.customerId,
    transferId: input.transferId,
    fundingJournalId: transfer.journal_id,
    redemptionMethod: input.redemptionMethod,
    lock: 'SHARE',
  });
  if (
    !resolved ||
    !UUID.test(resolved.institutionId) ||
    !/^[0-9a-f]{64}$/.test(resolved.evidenceFingerprint)
  )
    throw new ServiceUnavailableException('Cash-to-cash institutional authorization unavailable');
  return { transfer, resolved };
}

export async function preflightClaimContext(
  manager: EntityManager,
  authority: CashToCashClaimFinancialContext,
  input: ClaimBindingInput,
): Promise<void> {
  await context(manager, authority, input);
}

export async function bindClaimChallenge(
  manager: EntityManager,
  authority: CashToCashClaimFinancialContext,
  input: ClaimBindingInput,
): Promise<void> {
  const { transfer, resolved } = await context(manager, authority, input);
  const challenge = await manager.query<Array<{ id: string }>>(
    `SELECT id FROM mfa_challenges WHERE id=$1 AND customer_id=$2 AND purpose='CASH_TO_CASH_CLAIM' AND status='ACTIVE' AND expires_at>clock_timestamp() FOR UPDATE`,
    [input.challengeId, input.customerId],
  );
  if (!challenge[0]) throw new BadRequestException('Claim challenge unavailable');
  await reserveCashOutOtpIssuance(
    manager,
    input.customerId,
    input.destinationHash,
    input.transferId,
  );
  await manager.query(
    `UPDATE mfa_challenges SET status='REVOKED',revoked_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE status='ACTIVE' AND id IN (SELECT challenge_id FROM cash_to_cash_claim_challenge_bindings WHERE transfer_id=$1)`,
    [input.transferId],
  );
  await manager.query(
    `INSERT INTO cash_to_cash_claim_challenge_bindings(challenge_id,transfer_id,customer_id,agent_id,agent_session_id,beneficiary_phone,destination_hash,principal_minor,currency,redemption_method,funding_journal_id,institution_id,evidence_fingerprint,funding_agent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.challengeId,
      input.transferId,
      input.customerId,
      input.agentId,
      input.agentSessionId,
      transfer.beneficiary_phone,
      input.destinationHash,
      transfer.principal_minor,
      transfer.currency,
      input.redemptionMethod,
      transfer.journal_id,
      resolved.institutionId,
      resolved.evidenceFingerprint,
      transfer.agent_id,
    ],
  );
}

export async function requireClaimChallenge(
  manager: EntityManager,
  authority: CashToCashClaimFinancialContext,
  input: ClaimBindingInput,
): Promise<string[]> {
  const { transfer, resolved } = await context(manager, authority, input);
  const rows = await manager.query<Array<{ challenge_id: string }>>(
    `SELECT b.challenge_id FROM cash_to_cash_claim_challenge_bindings b JOIN mfa_challenges c ON c.id=b.challenge_id WHERE b.challenge_id=$1 AND b.transfer_id=$2 AND b.customer_id=$3 AND b.agent_id=$4 AND b.agent_session_id=$5 AND b.beneficiary_phone=$6 AND b.destination_hash=$7 AND b.principal_minor=$8 AND b.currency=$9 AND b.redemption_method=$10 AND b.funding_journal_id=$11 AND b.institution_id=$12 AND b.evidence_fingerprint=$13 AND b.funding_agent_id=$14 AND c.purpose='CASH_TO_CASH_CLAIM'`,
    [
      input.challengeId,
      input.transferId,
      input.customerId,
      input.agentId,
      input.agentSessionId,
      transfer.beneficiary_phone,
      input.destinationHash,
      transfer.principal_minor,
      transfer.currency,
      input.redemptionMethod,
      transfer.journal_id,
      resolved.institutionId,
      resolved.evidenceFingerprint,
      transfer.agent_id,
    ],
  );
  if (!rows[0]) throw new ConflictException('Claim authorization context unavailable');
  const keys = await cashOutOtpVerificationBudget(
    manager,
    input.customerId,
    input.destinationHash,
    input.transferId,
  );
  if (!keys) throw new ConflictException('Claim authorization temporarily unavailable');
  return keys;
}
export { recordCashOutOtpFailure };
