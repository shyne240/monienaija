import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import {
  governedAction,
  governedChangeFingerprint,
} from '../authorization/governed-action.registry';
import { governedChangeConsumptionError } from '../authorization/commercial-rule-governance.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { SettlementAccountService } from '../payment/settlement-account.service';
import { SettlementAccountRole } from '../payment/payment.enums';

export type BankToWalletExceptionReason =
  | 'UNMATCHED_RECEIVING_ACCOUNT'
  | 'UNVERIFIABLE_PAYMENT'
  | 'REFERENCE_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'IDENTITY_BLOCKED'
  | 'ELIGIBILITY_BLOCKED'
  | 'LIMIT_BLOCKED'
  | 'POSTING_RESTRICTION';

export type BankToWalletExceptionState =
  | 'OPEN'
  | 'APPROVED_FOR_RELEASE'
  | 'RELEASED'
  | 'APPROVED_FOR_RETURN'
  | 'RETURNED'
  | 'CANCELLED';

export interface RecordExceptionInput {
  businessReference: string;
  institutionId: string | null;
  providerKey: string;
  environment: 'sandbox' | 'production';
  providerTransactionReference: string;
  providerPaymentReference?: string | null;
  receivingAccountNumber?: string | null;
  walletId?: string | null;
  currency: string;
  grossAmountMinor: string;
  providerFeeMinor: string;
  settlementAmountMinor?: string | null;
  monienaijaFeeMinor?: string;
  customerCreditMinor?: string;
  reason: BankToWalletExceptionReason;
  evidence?: Record<string, unknown>;
}

const ACTION = 'BANK_TO_WALLET_EXCEPTION_RESOLUTION';
const RESOURCE_TYPE = 'BANK_TO_WALLET_EXCEPTION';

export function nextActionFor(reason: BankToWalletExceptionReason): string {
  if (reason === 'UNMATCHED_RECEIVING_ACCOUNT') return 'IDENTIFY_ACCOUNT_THEN_FINANCE_REVIEW';
  if (reason === 'UNVERIFIABLE_PAYMENT') return 'RETRY_PROVIDER_VERIFICATION';
  if (reason === 'REFERENCE_MISMATCH' || reason === 'AMOUNT_MISMATCH')
    return 'FINANCE_RECONCILE_PROVIDER_EVIDENCE';
  if (reason === 'IDENTITY_BLOCKED' || reason === 'ELIGIBILITY_BLOCKED')
    return 'COMPLETE_IDENTITY_REVIEW_THEN_FINANCE_DECISION';
  return 'FINANCE_DECIDE_RELEASE_OR_RETURN';
}

/** Deterministic fingerprint: an approval for one exception and decision cannot authorize another. */
export function exceptionDecisionFingerprint(
  exceptionId: string,
  decision: 'RELEASE' | 'RETURN',
  reason: string,
): string {
  return governedChangeFingerprint(ACTION, RESOURCE_TYPE, exceptionId, { decision, reason });
}

/**
 * Traceable exceptions for verified funds that cannot be credited.
 *
 * Nothing here invents an accounting treatment. An exception keeps the provider identity, our
 * business reference, the amount chain and the reason it was withheld. A release or return is a
 * governed Finance decision: FINANCE_PREPARER requests, an independent FINANCE_CONTROLLER checks,
 * and execution consumes the approval in the same transaction as any ledger effect.
 *
 * A return is recorded as an approved decision, not as "money returned": no Monnify payout adapter
 * or externally confirmed return evidence exists in this PR. That authority gap is stated in the
 * evidence rather than hidden behind a state transition.
 */
@Injectable()
export class BankToWalletExceptionService {
  constructor(
    private readonly db: DataSource,
    private readonly approvals: PrivilegedActionApprovalService,
    private readonly ledger: LedgerService,
    private readonly settlementAccounts: SettlementAccountService,
  ) {}

  /** Idempotent on the durable business reference. Replays return the original exception. */
  async record(
    input: RecordExceptionInput,
    manager?: EntityManager,
  ): Promise<{ id: string; created: boolean }> {
    const runner = manager ?? this.db;
    const rows = await runner.query<Array<{ id: string }>>(
      `INSERT INTO bank_to_wallet_exceptions
        (business_reference,institution_id,provider_key,environment,provider_transaction_reference,
         provider_payment_reference,receiving_account_number,wallet_id,currency,gross_amount_minor,
         provider_fee_minor,settlement_amount_minor,monienaija_fee_minor,customer_credit_minor,
         reason,state,permitted_next_action,evidence)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'OPEN',$16,$17::jsonb)
       ON CONFLICT (business_reference) DO NOTHING RETURNING id`,
      [
        input.businessReference,
        input.institutionId,
        input.providerKey,
        input.environment,
        input.providerTransactionReference,
        input.providerPaymentReference ?? null,
        input.receivingAccountNumber ?? null,
        input.walletId ?? null,
        input.currency,
        input.grossAmountMinor,
        input.providerFeeMinor,
        input.settlementAmountMinor ?? null,
        input.monienaijaFeeMinor ?? '0',
        input.customerCreditMinor ?? '0',
        input.reason,
        nextActionFor(input.reason),
        JSON.stringify(input.evidence ?? {}),
      ],
    );
    if (rows[0]) return { id: rows[0].id, created: true };
    const existing = await runner.query<Array<{ id: string }>>(
      'SELECT id FROM bank_to_wallet_exceptions WHERE business_reference=$1',
      [input.businessReference],
    );
    if (!existing[0]) throw new ConflictException('Exception could not be recorded');
    return { id: existing[0].id, created: false };
  }

  async view(id: string, manager?: EntityManager) {
    const rows = await (manager ?? this.db).query<Array<Record<string, unknown>>>(
      `SELECT id,business_reference,institution_id,provider_key,environment,
              provider_transaction_reference,provider_payment_reference,receiving_account_number,
              wallet_id,currency,gross_amount_minor::text AS gross_amount_minor,
              provider_fee_minor::text AS provider_fee_minor,
              settlement_amount_minor::text AS settlement_amount_minor,
              monienaija_fee_minor::text AS monienaija_fee_minor,
              customer_credit_minor::text AS customer_credit_minor,
              reason,state,permitted_next_action,approval_id,decision_by,decision_at,
              resolution_journal_id,notes,created_at,updated_at
         FROM bank_to_wallet_exceptions WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Bank to Wallet exception not found');
    return rows[0];
  }

  async byBusinessReference(reference: string) {
    const rows = await this.db.query<Array<{ id: string }>>(
      'SELECT id FROM bank_to_wallet_exceptions WHERE business_reference=$1',
      [reference],
    );
    if (!rows[0]) throw new NotFoundException('Bank to Wallet exception not found');
    return this.view(rows[0].id);
  }

  /** Maker side. No ledger or wallet effect is created by this call. */
  async requestDecision(
    principal: AuthorizationPrincipal,
    input: {
      exceptionId: string;
      decision: 'RELEASE' | 'RETURN';
      reason: string;
      expiresInSeconds?: number;
    },
  ) {
    const definition = governedAction(ACTION);
    if (!definition) throw new ConflictException('Exception governance action is not registered');
    const exception = await this.view(this.assertUuid(input.exceptionId, 'exceptionId'));
    if (exception.state !== 'OPEN') {
      throw new ConflictException(`Exception is ${String(exception.state)}, not OPEN`);
    }
    const decision = input.decision;
    const reason = this.normalizeReason(input.reason);
    if (decision !== 'RELEASE' && decision !== 'RETURN') {
      throw new BadRequestException('decision must be RELEASE or RETURN');
    }
    const fingerprint = exceptionDecisionFingerprint(String(exception.id), decision, reason);
    const result = await this.approvals.request({
      principal,
      policy: {
        resourceType: RESOURCE_TYPE,
        action: ACTION,
        allowedPrincipalTypes: ['OPERATOR', 'PRIVILEGED'],
        requiredRoles: definition.initiatingRoles,
        requiredFunctions: definition.initiatingFunctionCodes,
        minimumAssurance: definition.minimumAssurance,
        customerAccess: 'NONE',
      },
      resource: { type: RESOURCE_TYPE, id: String(exception.id) },
      actionFingerprint: fingerprint,
      reason,
      requestDetails: {
        businessReference: exception.business_reference,
        decision,
        reason,
        amountMinor: exception.customer_credit_minor,
      },
      approvalScope: definition.approvalScope,
      expiresInSeconds: input.expiresInSeconds,
    });
    if (!result.approval) {
      throw new ForbiddenException(`Decision request denied: ${result.reason ?? 'UNAUTHORIZED'}`);
    }
    return result.approval;
  }

  /**
   * Checker-execution side. Approval consumption, the exception state transition and any ledger
   * posting commit together; a replay with the same approval is idempotent.
   */
  async executeDecision(
    principal: AuthorizationPrincipal,
    input: {
      exceptionId: string;
      approvalId: string;
      decision: 'RELEASE' | 'RETURN';
      reason: string;
      /** Required when a RETURN has been executed by the provider and externally confirmed. */
      externalReference?: string;
    },
  ) {
    const exceptionId = this.assertUuid(input.exceptionId, 'exceptionId');
    const approvalId = this.assertUuid(input.approvalId, 'approvalId');
    const decision = input.decision;
    if (decision !== 'RELEASE' && decision !== 'RETURN') {
      throw new BadRequestException('decision must be RELEASE or RETURN');
    }
    const reason = this.normalizeReason(input.reason);
    const fingerprint = exceptionDecisionFingerprint(exceptionId, decision, reason);

    return this.db.transaction('SERIALIZABLE', async (manager) => {
      const rows = await manager.query<
        Array<{
          id: string;
          state: string;
          business_reference: string;
          wallet_id: string | null;
          currency: string;
          customer_credit_minor: string;
          resolution_journal_id: string | null;
          evidence: Record<string, unknown>;
        }>
      >(
        `SELECT id,state,business_reference,wallet_id,currency,customer_credit_minor::text AS customer_credit_minor,resolution_journal_id,evidence
           FROM bank_to_wallet_exceptions WHERE id=$1 FOR UPDATE`,
        [exceptionId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Bank to Wallet exception not found');
      // A RETURN remains APPROVED_FOR_RETURN because no provider payout has been confirmed. The
      // immutable resolution row, not a terminal state, is therefore the replay identity.
      const done = await manager.query<Array<{ decision: string; approval_id: string }>>(
        'SELECT decision,approval_id FROM bank_to_wallet_resolutions WHERE exception_id=$1',
        [exceptionId],
      );
      if (done[0]) {
        if (done[0].decision === decision && done[0].approval_id === approvalId) {
          return {
            state: row.state,
            replayed: true,
            journalId: row.resolution_journal_id,
          };
        }
        throw new ConflictException('Exception has already been resolved');
      }
      const consumed = await this.approvals.consumeInTransaction(manager, {
        principal,
        approvalId,
        actionType: ACTION,
        resource: { type: RESOURCE_TYPE, id: exceptionId },
        actionFingerprint: fingerprint,
      });
      if (!consumed.approved)
        throw governedChangeConsumptionError(consumed.reason, consumed.approval?.status);

      let journalId: string | null = null;
      let nextState: 'RELEASED' | 'APPROVED_FOR_RETURN';
      if (decision === 'RELEASE') {
        const settled = await this.hasConfirmedSettlement(manager, exceptionId, row.evidence);
        if (!settled) {
          throw new ConflictException(
            'Release requires confirmed provider settlement evidence; no wallet credit is posted',
          );
        }
        if (!row.wallet_id || BigInt(row.customer_credit_minor) <= 0n) {
          throw new ConflictException('Exception has no creditable wallet or net amount');
        }
        journalId = await this.postRelease(
          manager,
          row.wallet_id,
          row.currency,
          row.customer_credit_minor,
          row.business_reference,
          exceptionId,
        );
        nextState = 'RELEASED';
      } else {
        // No provider payout adapter is implemented. The decision is governed and recorded, but it
        // does not claim that money has left Monnify or reached the customer's bank.
        nextState = 'APPROVED_FOR_RETURN';
      }

      await manager.query(
        `UPDATE bank_to_wallet_exceptions
            SET state=$2,approval_id=$3,decision_by=$4,decision_at=clock_timestamp(),
                resolution_journal_id=$5,notes=$6,updated_at=clock_timestamp()
          WHERE id=$1`,
        [
          exceptionId,
          nextState,
          approvalId,
          principal.principalId,
          journalId,
          decision === 'RETURN'
            ? input.externalReference
              ? `Return authorised; provider reference ${input.externalReference}`
              : 'Return authorised; external provider confirmation still required'
            : null,
        ],
      );
      await manager.query(
        `INSERT INTO bank_to_wallet_resolutions
          (exception_id,decision,approval_id,performed_by,resolution_journal_id,external_reference,decision_binding)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (exception_id) DO NOTHING`,
        [
          exceptionId,
          decision,
          approvalId,
          principal.principalId,
          journalId,
          input.externalReference ?? null,
          JSON.stringify({ fingerprint, reason, decision }),
        ],
      );
      return { state: nextState, replayed: false, journalId };
    });
  }

  private async hasConfirmedSettlement(
    manager: EntityManager,
    exceptionId: string,
    evidence: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await manager.query<
      Array<{ settlement_reference: string | null; settlement_state: string }>
    >(
      `SELECT settlement_reference,settlement_state
         FROM bank_to_wallet_settlements
        WHERE business_reference=(SELECT business_reference FROM bank_to_wallet_exceptions WHERE id=$1)`,
      [exceptionId],
    );
    return (
      rows[0]?.settlement_state === 'RECONCILED' ||
      typeof evidence.settlementReference === 'string' ||
      typeof evidence.settlement_reference === 'string'
    );
  }

  private async postRelease(
    manager: EntityManager,
    walletId: string,
    currency: string,
    amountMinor: string,
    businessReference: string,
    exceptionId: string,
  ): Promise<string> {
    const wallets = await manager.query<Array<{ ledger_account_id: string }>>(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1 AND status='ACTIVE' AND currency=$2`,
      [walletId, currency],
    );
    if (!wallets[0]) throw new ConflictException('Release destination wallet is not active');
    const asset = await this.settlementAccounts.getAccountId(
      manager,
      currency,
      SettlementAccountRole.SETTLEMENT_ASSET,
    );
    return this.ledger.postJournalInTransaction(manager, {
      idempotencyKey: `b2w-release:${businessReference}`,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: businessReference,
      description: 'Governed release of withheld bank transfer to customer wallet',
      correlationId: businessReference,
      metadata: { businessReference, exceptionId, decision: 'RELEASE' },
      lines: [
        { accountId: asset, direction: LedgerEntryDirection.DEBIT, amountMinor },
        {
          accountId: wallets[0].ledger_account_id,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor,
        },
      ],
    });
  }

  private normalizeReason(reason: string): string {
    const value = (reason ?? '').trim();
    if (value.length < 4 || value.length > 500) {
      throw new BadRequestException('reason must be between 4 and 500 characters');
    }
    return value;
  }

  private assertUuid(value: string, field: string): string {
    const normalized = (value ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }
}
