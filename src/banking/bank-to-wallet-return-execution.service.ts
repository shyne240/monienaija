import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { BankingProviderRegistry } from './banking-provider.registry';

/**
 * Executes a governed Bank→Wallet RETURN decision with exactly one provider refund instruction.
 *
 * The RETURN approval is not money returned: it authorizes this service to send one refund under a
 * durable MonieNaija reference. Every retry addresses that same record; there is deliberately no
 * method that creates a second instruction. An uncertain submission is resolved by status enquiry,
 * never by another submission, and a confirmed outcome is final.
 */
@Injectable()
export class BankToWalletReturnExecutionService {
  private static readonly PROVIDER_KEY = 'MONNIFY';

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
    /** Live refunds stay disabled until refund entitlement and funding are owner-approved. */
    private readonly enabled: boolean = false,
  ) {}

  /**
   * Creates the one durable refund intent for a consumed RETURN decision. Deterministic by
   * construction: the reference is derived from the original business reference and a unique
   * constraint makes a second intent for the same exception impossible.
   */
  async prepare(exceptionId: string): Promise<ReturnRefundView> {
    const authority = await this.db.query<
      Array<{
        id: string;
        institution_id: string;
        business_reference: string;
        original_provider_reference: string;
        amount_minor: string;
        currency: string;
        state: string;
        approval_status: string;
      }>
    >(
      `SELECT e.id,e.institution_id::text,e.business_reference,e.provider_transaction_reference
              AS original_provider_reference,
              e.customer_credit_minor::text AS amount_minor,e.currency,e.state,
              a.status AS approval_status
         FROM bank_to_wallet_exceptions e
         JOIN bank_to_wallet_resolutions r ON r.exception_id=e.id AND r.decision='RETURN'
         JOIN privileged_action_approvals a ON a.id=r.approval_id
        WHERE e.id=$1`,
      [exceptionId],
    );
    const row = authority[0];
    if (!row || row.state !== 'APPROVED_FOR_RETURN' || row.approval_status !== 'CONSUMED') {
      throw new ConflictException(
        'A return refund requires a consumed RETURN approval on an APPROVED_FOR_RETURN exception',
      );
    }
    const returnReference = `RTN${createHash('sha256')
      .update(row.business_reference)
      .digest('hex')
      .slice(0, 30)
      .toUpperCase()}`;
    const inserted = await this.db.query<Array<{ id: string }>>(
      `INSERT INTO bank_to_wallet_return_refunds
        (institution_id,exception_id,approval_id,business_reference,original_provider_reference,
         return_reference,refund_reference,amount_minor,currency,state)
       SELECT $2,$1,r.approval_id,e.business_reference,e.provider_transaction_reference,
              $3,$3,e.customer_credit_minor,e.currency,'APPROVED'
         FROM bank_to_wallet_exceptions e
         JOIN bank_to_wallet_resolutions r ON r.exception_id=e.id
        WHERE e.id=$1
        ON CONFLICT (exception_id) DO NOTHING
        RETURNING id`,
      [exceptionId, row.institution_id, returnReference],
    );
    const id = inserted[0]?.id ?? (await this.findIdByException(exceptionId));
    if (!id) throw new ConflictException('Return refund intent could not be created or resolved');
    return this.view(id);
  }

  /**
   * Submits at most one provider refund. Timeout, transport fault and duplicate-code responses
   * resolve to UNKNOWN, which is a request for status enquiry — not a permission to send again.
   */
  async dispatch(returnId: string, correlationId: string): Promise<ReturnRefundView> {
    const record = await this.lock(returnId);
    if (record.state !== 'APPROVED') return this.toView(record);
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Refund execution is disabled until entitlement and funding are owner-approved',
      );
    }
    const provider = this.registry.find(BankToWalletReturnExecutionService.PROVIDER_KEY);
    if (
      !provider ||
      !this.registry.supports(
        BankToWalletReturnExecutionService.PROVIDER_KEY,
        'REFUND_INITIATION',
      ) ||
      !provider.initiateRefund
    ) {
      throw new ServiceUnavailableException('No registered provider can initiate refunds');
    }

    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds SET state='SUBMITTING',attempts=attempts+1
        WHERE id=$1 AND state='APPROVED'`,
      [returnId],
    );
    let result;
    try {
      result = await provider.initiateRefund(
        {
          originalProviderReference: record.original_provider_reference,
          refundReference: record.return_reference,
          amountMinor: record.amount_minor,
          currency: record.currency,
          reason: 'Withheld bank transfer returned',
          customerNote: 'Return of funds',
          correlationId,
        },
        { correlationId },
      );
    } catch {
      return this.markUnknown(returnId, 'PROVIDER_TRANSPORT_TIMEOUT');
    }
    if (!result.ok) {
      const code = result.error.code;
      // R9 is the provider's duplicate-refund response: the instruction may already exist, so the
      // only safe remedy is authoritative status lookup under the SAME reference.
      const uncertain = ['TIMEOUT', 'TRANSPORT', 'RATE_LIMITED', 'AUTHENTICATION', 'CONTRACT'];
      if (code === 'R9' || uncertain.includes(result.error.category)) {
        return this.markUnknown(returnId, code);
      }
      return this.terminal(returnId, 'FAILED', code, result.error.detail);
    }
    const value = result.value;
    if (value.outcome === 'REJECTED') {
      return this.terminal(returnId, 'FAILED', value.providerStatus ?? 'REJECTED');
    }
    if (value.outcome === 'UNKNOWN') {
      return this.markUnknown(returnId, value.providerStatus ?? 'PROVIDER_OUTCOME_UNKNOWN');
    }
    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds
          SET state=$2,provider_status=$3,refund_reference=COALESCE(refund_reference,$4),
              submitted_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND state='SUBMITTING'`,
      [returnId, 'PENDING', value.providerStatus ?? value.outcome, value.refundReference],
    );
    return this.view(returnId);
  }

  /**
   * The only sanctioned path after an uncertain submission, a webhook hint or a duplicate update.
   * Terminal outcomes are final: a late SUCCESS payload or repeated FAILED notification cannot
   * overwrite them.
   */
  async enquire(returnId: string, correlationId: string): Promise<ReturnRefundView> {
    const record = await this.lock(returnId);
    if (record.state === 'RETURNED' || record.state === 'FAILED' || record.state === 'APPROVED') {
      return this.toView(record);
    }
    const provider = this.registry.find(BankToWalletReturnExecutionService.PROVIDER_KEY);
    if (!provider?.getRefundStatus || !this.registry.supports(
      BankToWalletReturnExecutionService.PROVIDER_KEY,
      'REFUND_INITIATION',
    )) {
      throw new ServiceUnavailableException('No registered provider can enquire on refunds');
    }
    const reference = record.refund_reference ?? record.return_reference;
    let result;
    try {
      result = await provider.getRefundStatus(reference, { correlationId });
    } catch {
      return this.markCheckedUnknown(returnId, 'PROVIDER_TRANSPORT_TIMEOUT');
    }
    if (!result.ok) return this.markCheckedUnknown(returnId, result.error.code);
    const value = result.value;
    const providerStatus = value.providerStatus ?? value.outcome;
    if (value.outcome === 'COMPLETED') {
      await this.confirmReturned(returnId, providerStatus, value.completedAt ?? null);
      return this.view(returnId);
    }
    if (value.outcome === 'FAILED') {
      await this.terminal(returnId, 'FAILED', providerStatus);
      return this.view(returnId);
    }
    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds
          SET state=$2,provider_status=$3,last_checked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND state NOT IN ('RETURNED','FAILED')`,
      [returnId, value.outcome === 'PENDING' ? 'PENDING' : 'UNKNOWN', providerStatus],
    );
    return this.view(returnId);
  }

  async view(returnId: string): Promise<ReturnRefundView> {
    const rows = await this.db.query<Array<DbReturnRefund>>(
      `SELECT id,institution_id::text AS institution_id,exception_id::text AS exception_id,
              business_reference,original_provider_reference,return_reference,refund_reference,
              amount_minor::text AS amount_minor,currency,state,provider_status,last_failure_code,
              attempts,submitted_at,last_checked_at,resolved_at,evidence
         FROM bank_to_wallet_return_refunds WHERE id=$1`,
      [returnId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Return refund record not found');
    return this.toView(row);
  }

  private async findIdByException(exceptionId: string): Promise<string | null> {
    const rows = await this.db.query<Array<{ id: string }>>(
      'SELECT id FROM bank_to_wallet_return_refunds WHERE exception_id=$1',
      [exceptionId],
    );
    return rows[0]?.id ?? null;
  }

  private async lock(returnId: string): Promise<DbReturnRefund> {
    const rows = await this.db.query<Array<DbReturnRefund>>(
      `SELECT id,institution_id::text AS institution_id,exception_id::text AS exception_id,
              business_reference,original_provider_reference,return_reference,refund_reference,
              amount_minor::text AS amount_minor,currency,state,provider_status,last_failure_code,
              attempts,submitted_at,last_checked_at,resolved_at,evidence
         FROM bank_to_wallet_return_refunds WHERE id=$1 FOR UPDATE`,
      [returnId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Return refund record not found');
    return row;
  }

  private async markUnknown(returnId: string, code: string): Promise<ReturnRefundView> {
    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds
          SET state='UNKNOWN',last_failure_code=$2,provider_status=NULL,
              submitted_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND state='SUBMITTING'`,
      [returnId, code.slice(0, 64)],
    );
    return this.view(returnId);
  }

  private async markCheckedUnknown(returnId: string, code: string): Promise<ReturnRefundView> {
    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds
          SET state='UNKNOWN',last_failure_code=$2,last_checked_at=clock_timestamp(),
              updated_at=clock_timestamp()
        WHERE id=$1 AND state NOT IN ('RETURNED','FAILED')`,
      [returnId, code.slice(0, 64)],
    );
    return this.view(returnId);
  }

  private async terminal(
    returnId: string,
    state: 'FAILED' | 'UNKNOWN',
    code?: string,
    detail?: string,
  ): Promise<ReturnRefundView> {
    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds
          SET state=$2,last_failure_code=$3,provider_status=$4,resolved_at=clock_timestamp(),
              updated_at=clock_timestamp()
        WHERE id=$1 AND state NOT IN ('RETURNED','FAILED')`,
      [returnId, state, code?.slice(0, 64) ?? null, detail?.slice(0, 64) ?? null],
    );
    return this.view(returnId);
  }

  private async confirmReturned(
    returnId: string,
    providerStatus: string,
    completedAt: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE bank_to_wallet_return_refunds
          SET state='RETURNED',provider_status=$2,resolved_at=clock_timestamp(),
              last_checked_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND state NOT IN ('RETURNED','FAILED')`,
      [returnId, providerStatus],
    );
    const record = await this.view(returnId);
    // The original exception/trace is preserved; only its state and note are advanced by the
    // confirmed provider outcome. The refund row remains the authority for the money movement.
    await this.db.query(
      `UPDATE bank_to_wallet_exceptions
          SET state='RETURNED',
              notes=COALESCE(notes,'') || $2,
              updated_at=clock_timestamp()
        WHERE id=$1 AND state <> 'RETURNED'`,
      [
        record.exceptionId,
        ` Money returned by provider; MonieNaija return ${record.returnReference}, Monnify refund ${record.refundReference ?? record.returnReference}${completedAt ? `, completed ${completedAt}` : ''}.`,
      ],
    );
  }

  private toView(row: DbReturnRefund): ReturnRefundView {
    return {
      id: row.id,
      institutionId: row.institution_id,
      exceptionId: row.exception_id,
      businessReference: row.business_reference,
      originalProviderReference: row.original_provider_reference,
      returnReference: row.return_reference,
      refundReference: row.refund_reference ?? null,
      amountMinor: row.amount_minor,
      currency: row.currency,
      state: row.state as ReturnRefundState,
      providerStatus: row.provider_status ?? null,
      lastFailureCode: row.last_failure_code ?? null,
      attempts: Number(row.attempts),
      submittedAt: row.submitted_at ?? null,
      resolvedAt: row.resolved_at ?? null,
    };
  }
}

export type ReturnRefundState =
  | 'APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PENDING'
  | 'RETURNED'
  | 'FAILED'
  | 'UNKNOWN';

export interface ReturnRefundView {
  readonly id: string;
  readonly institutionId: string;
  readonly exceptionId: string;
  readonly businessReference: string;
  readonly originalProviderReference: string;
  readonly returnReference: string;
  readonly refundReference: string | null;
  readonly amountMinor: string;
  readonly currency: string;
  readonly state: ReturnRefundState;
  readonly providerStatus: string | null;
  readonly lastFailureCode: string | null;
  readonly attempts: number;
  readonly submittedAt: string | null;
  readonly resolvedAt: string | null;
}

interface DbReturnRefund {
  id: string;
  institution_id: string;
  exception_id: string;
  business_reference: string;
  original_provider_reference: string;
  return_reference: string;
  refund_reference: string | null;
  amount_minor: string;
  currency: string;
  state: string;
  provider_status: string | null;
  last_failure_code: string | null;
  attempts: string | number;
  submitted_at: string | null;
  last_checked_at: string | null;
  resolved_at: string | null;
  evidence: Record<string, unknown>;
}
