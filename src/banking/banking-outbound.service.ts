import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { BankingProviderRegistry } from './banking-provider.registry';
import type {
  BankingProvider,
  BankingProviderResult,
  OutboundTransferSubmissionResult,
  TransferStatusResult,
} from './banking-provider.types';

/**
 * Outbound transfer execution: the path where getting uncertainty wrong costs money twice.
 *
 * The rules below are not stylistic. Each is the direct consequence of a failure mode:
 *
 * 1. **The operation reference is created once, before the provider is called, and persisted.** A
 *    reference generated per attempt means a retry of an uncertain submission becomes a second,
 *    real transfer.
 * 2. **The reference is committed before the network call.** If the process dies mid-call, subsequent
 *    recovery finds a record that says "we were about to submit with this reference" rather than
 *    nothing at all. An unrecorded attempt is indistinguishable from no attempt, which is how a
 *    duplicate gets created by an operator doing the sensible thing.
 * 3. **A timeout or transport fault resolves to UNKNOWN and stops.** It is never retried in this
 *    service, and it is never shown as a failure. `UNKNOWN` is a request for enquiry, not an outcome.
 * 4. **Only an explicit provider rejection becomes REJECTED.** Anything the adapter could not classify
 *    stays uncertain, because "we do not know" and "it failed" have different remedies.
 * 5. **No new reference is ever minted for an existing record.** There is deliberately no
 *    `resubmit()` method here. Recovery is `enquire()`, which asks the provider what happened.
 *
 * There is also no `markSuccessful()`. A human investigating an uncertain operation may move it to
 * MANUAL_REVIEW; they may not assert what the provider did.
 */

export type OutboundState =
  | 'CREATED'
  | 'SUBMITTING'
  | 'PENDING_PROVIDER'
  | 'PENDING_VERIFICATION'
  | 'UNKNOWN'
  | 'MANUAL_REVIEW'
  | 'SUCCESSFUL'
  | 'REVERSED'
  | 'FAILED'
  | 'CANCELLED';

export interface SubmitOutboundCommand {
  institutionId: string;
  walletId: string;
  providerKey: string;
  environment: 'sandbox' | 'production';
  currency: string;
  amountMinor: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  narration: string;
  correlationId: string;
}

export interface OutboundRecordView {
  id: string;
  operation_reference: string;
  state: OutboundState;
  provider_status: string | null;
  provider_transaction_reference: string | null;
  requires_additional_authorization: boolean;
  attempts: number;
}

const MINOR_UNITS = /^[1-9][0-9]{0,18}$/;
const ACCOUNT = /^[0-9]{4,32}$/;
const BANK_CODE = /^[A-Z0-9]{3,20}$/;

@Injectable()
export class BankingOutboundService {
  private readonly logger = new Logger(BankingOutboundService.name);

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
  ) {}

  /**
   * The application DataSource, exposed so the dispatch worker drives this service on the same
   * connection pool and the same transaction discipline. It is deliberately the only thing the worker
   * reads from here: the worker must not hold a second handle it could query around this service.
   */
  get dataSource(): DataSource {
    return this.db;
  }

  /**
   * Deterministic operation reference.
   *
   * Derived from the commitment identity rather than random, so two concurrent callers for the same
   * commitment derive the *same* reference and the unique constraint turns the second into a conflict
   * instead of a second transfer. A random reference would make that collision impossible to detect.
   */
  operationReference(institutionId: string, walletId: string, idempotencyKey: string): string {
    const digest = createHash('sha256')
      .update(`${institutionId}|${walletId}|${idempotencyKey}`)
      .digest('hex');
    return `OP${digest.slice(0, 30).toUpperCase()}`;
  }

  private async record(manager: EntityManager, id: string): Promise<OutboundRecordView> {
    const rows = await manager.query<OutboundRecordView[]>(
      `SELECT id,operation_reference,state,provider_status,provider_transaction_reference,
              requires_additional_authorization,attempts
         FROM banking_outbound_operations WHERE id=$1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Banking outbound operation not found');
    return row;
  }

  /**
   * Creates the durable record *before* any provider call.
   *
   * Two-phase on purpose: `prepare()` commits the intent and its reference, then `dispatch()` performs
   * the call and records whatever was learned. Splitting them means a crash between the two leaves an
   * inspectable record rather than an invisible attempt.
   */
  async prepare(
    command: SubmitOutboundCommand,
    idempotencyKey: string,
  ): Promise<{ id: string; operationReference: string; alreadyExisted: boolean }> {
    if (!MINOR_UNITS.test(command.amountMinor)) {
      throw new Error('amountMinor must be a positive integer string of minor units');
    }
    if (!ACCOUNT.test(command.destinationAccountNumber)) {
      throw new Error('destinationAccountNumber is malformed');
    }
    if (!BANK_CODE.test(command.destinationBankCode)) {
      throw new Error('destinationBankCode is malformed');
    }
    const reference = this.operationReference(
      command.institutionId,
      command.walletId,
      idempotencyKey,
    );
    const existing = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM banking_outbound_operations
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3 AND operation_reference=$4`,
      [command.institutionId, command.providerKey, command.environment, reference],
    );
    if (existing[0]) {
      return { id: existing[0].id, operationReference: reference, alreadyExisted: true };
    }
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO banking_outbound_operations
        (id,institution_id,provider_key,environment,operation_reference,wallet_id,currency,
         amount_minor,destination_bank_code,destination_account_number,destination_account_name,state)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CREATED')
       ON CONFLICT (institution_id,provider_key,environment,operation_reference) DO NOTHING`,
      [
        id,
        command.institutionId,
        command.providerKey,
        command.environment,
        reference,
        command.walletId,
        command.currency,
        command.amountMinor,
        command.destinationBankCode,
        command.destinationAccountNumber,
        command.destinationAccountName,
      ],
    );
    const inserted = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM banking_outbound_operations
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3 AND operation_reference=$4`,
      [command.institutionId, command.providerKey, command.environment, reference],
    );
    if (!inserted[0]) throw new ServiceUnavailableException('Unable to persist outbound operation');
    return {
      id: inserted[0].id,
      operationReference: reference,
      alreadyExisted: inserted[0].id !== id,
    };
  }

  /**
   * Performs the provider submission exactly once for a prepared record.
   *
   * Refuses to run for anything that has already been attempted. That refusal is the mechanism behind
   * "never retry an uncertain submission": the only way to call the provider again is to have a record
   * that was never attempted.
   */
  async dispatch(id: string, command: SubmitOutboundCommand): Promise<OutboundRecordView> {
    const provider = this.requireProvider(command.providerKey);
    const existing = await this.record(this.db.manager, id);

    if (existing.state !== 'CREATED') {
      // Already attempted — possibly uncertainly. Submitting again would risk a second transfer.
      this.logger.warn(
        `Refusing to resubmit banking operation ${existing.operation_reference} in state ${existing.state}`,
      );
      return existing;
    }

    // Monnify's current disbursement contract requires the verified beneficiary name. The A6
    // commitment binds the destination by immutable reference and deliberately stores no display
    // name, so resolve it from the provider's documented name enquiry HERE, once, before submission.
    // Nothing has been sent at this point, so an unresolved name may fail closed without creating
    // an uncertain financial outcome. The name is persisted on the same durable record so retries
    // reuse the same verified value rather than re-enquiring a different one.
    if (!command.destinationAccountName.trim()) {
      if (!provider.enquireAccountName) {
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='FAILED',last_failure_code='DESTINATION_NAME_UNAVAILABLE',
                  resolved_at=clock_timestamp()
            WHERE id=$1 AND state='CREATED'`,
          [id],
        );
        return this.record(this.db.manager, id);
      }
      let enquiry;
      try {
        enquiry = await provider.enquireAccountName(
          {
            providerBankCode: command.destinationBankCode,
            accountNumber: command.destinationAccountNumber,
          },
          { correlationId: command.correlationId },
        );
      } catch {
        enquiry = undefined;
      }
      const name =
        enquiry && enquiry.ok && enquiry.value.outcome === 'RESOLVED'
          ? enquiry.value.accountName?.trim()
          : undefined;
      if (!name) {
        // No money moved. FAILED is truthful here, and NOT an instruction to resubmit with a
        // guessed name from a beneficiary label.
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='FAILED',last_failure_code='DESTINATION_NAME_UNRESOLVED',
                  resolved_at=clock_timestamp()
            WHERE id=$1 AND state='CREATED'`,
          [id],
        );
        return this.record(this.db.manager, id);
      }
      await this.db.query(
        `UPDATE banking_outbound_operations SET destination_account_name=$2 WHERE id=$1`,
        [id, name.slice(0, 160)],
      );
      command = { ...command, destinationAccountName: name.slice(0, 160) };
    }

    await this.db.query(
      `UPDATE banking_outbound_operations
          SET state='SUBMITTING',attempts=attempts+1,last_attempted_at=clock_timestamp()
        WHERE id=$1 AND state='CREATED'`,
      [id],
    );

    let result: BankingProviderResult<OutboundTransferSubmissionResult>;
    try {
      result = await provider.submitOutboundTransfer!(
        {
          operationReference: existing.operation_reference,
          amountMinor: command.amountMinor,
          currency: command.currency,
          destinationBankCode: command.destinationBankCode,
          destinationAccountNumber: command.destinationAccountNumber,
          destinationAccountName: command.destinationAccountName,
          narration: command.narration,
          correlationId: command.correlationId,
        },
        { correlationId: command.correlationId },
      );
    } catch {
      // The adapter is supposed to normalize everything, but if it throws we still must not conclude
      // failure: the request may well have reached the provider.
      await this.markUncertain(id, 'ADAPTER_THREW');
      return this.record(this.db.manager, id);
    }

    if (!result.ok) {
      const { category, code } = result.error;
      if (category === 'PROVIDER_REJECTED' || category === 'VALIDATION') {
        // An explicit refusal before acceptance. Nothing was sent, so this is genuinely FAILED.
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='FAILED',last_failure_code=$2,resolved_at=clock_timestamp()
            WHERE id=$1`,
          [id, code],
        );
      } else {
        // Everything else — timeout, transport, authentication mid-flight, rate limit — leaves the
        // submission's fate unknown. Recording it as FAILED would be a lie with consequences.
        await this.markUncertain(id, code);
      }
      return this.record(this.db.manager, id);
    }

    const submission = result.value;
    switch (submission.outcome) {
      case 'ACCEPTED':
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='PENDING_PROVIDER',provider_status=$2,
                  provider_transaction_reference=COALESCE($3,provider_transaction_reference),
                  submitted_at=clock_timestamp()
            WHERE id=$1`,
          [id, 'ACCEPTED', submission.providerReference ?? null],
        );
        break;
      case 'PENDING':
        // An OTP challenge is explicitly not an accepted transfer.
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='PENDING_VERIFICATION',provider_status=$2,
                  requires_additional_authorization=$3,
                  provider_transaction_reference=COALESCE($4,provider_transaction_reference),
                  submitted_at=clock_timestamp()
            WHERE id=$1`,
          [
            id,
            'PENDING',
            submission.requiresAdditionalAuthorization === true,
            submission.providerReference ?? null,
          ],
        );
        break;
      case 'REJECTED':
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='FAILED',provider_status='REJECTED',resolved_at=clock_timestamp()
            WHERE id=$1`,
          [id],
        );
        break;
      case 'NOT_SENT':
        // The adapter is certain nothing reached the provider. This is the only state from which a
        // safe retry is possible, and even then it is a new explicit decision, not an automatic one.
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='CREATED',provider_status='NOT_SENT'
            WHERE id=$1`,
          [id],
        );
        break;
      case 'UNKNOWN':
      default:
        await this.markUncertain(id, 'PROVIDER_OUTCOME_UNKNOWN');
        break;
    }
    return this.record(this.db.manager, id);
  }

  /**
   * Resolves one of OUR operation references to the durable dispatch record. Used only by an
   * authenticated webhook to locate the record whose authoritative status must be re-read; it is
   * deliberately not a way to submit or settle anything.
   */
  async findByOperationReference(reference: string): Promise<string | null> {
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(reference)) return null;
    const rows = await this.db.query<Array<{ id: string }>>(
      'SELECT id FROM banking_outbound_operations WHERE operation_reference=$1 LIMIT 1',
      [reference],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Asks the provider what happened to an operation.
   *
   * This is the only sanctioned path out of UNKNOWN. It never submits, never mints a reference, and
   * leaves the record uncertain when the provider cannot say.
   */
  async enquire(id: string, correlationId: string): Promise<OutboundRecordView> {
    const rows = await this.db.query<
      Array<{ id: string; operation_reference: string; provider_key: string; state: OutboundState }>
    >(
      'SELECT id,operation_reference,provider_key,state FROM banking_outbound_operations WHERE id=$1',
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Banking outbound operation not found');
    const provider = this.requireProvider(row.provider_key);

    let result: BankingProviderResult<TransferStatusResult>;
    try {
      result = await provider.getTransferStatus!(row.operation_reference, { correlationId });
    } catch {
      // An enquiry that throws tells us nothing about the transfer. Leave it uncertain.
      return this.record(this.db.manager, id);
    }
    if (!result.ok) return this.record(this.db.manager, id);

    // The provider's reference is evidence, not an alternative identifier. Persist it on first
    // authoritative observation so a later replay, status enquiry or Finance review always sees
    // the original value rather than whatever a retry happened to return.
    if (result.value.providerReference) {
      await this.db.query(
        `UPDATE banking_outbound_operations
            SET provider_transaction_reference=COALESCE(provider_transaction_reference, $2)
          WHERE id=$1`,
        [id, result.value.providerReference.slice(0, 128)],
      );
    }

    switch (result.value.outcome) {
      case 'SUCCESSFUL':
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='SUCCESSFUL',provider_status=$2,resolved_at=clock_timestamp()
            WHERE id=$1 AND state NOT IN ('SUCCESSFUL','FAILED','REVERSED','CANCELLED')`,
          [id, result.value.providerStatus ?? 'SUCCESSFUL'],
        );
        break;
      case 'REVERSED':
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='REVERSED',provider_status=$2,resolved_at=clock_timestamp()
            WHERE id=$1 AND state NOT IN ('SUCCESSFUL','FAILED','REVERSED','CANCELLED')`,
          [id, result.value.providerStatus ?? 'REVERSED'],
        );
        break;
      case 'FAILED':
        await this.db.query(
          `UPDATE banking_outbound_operations
              SET state='FAILED',provider_status=$2,resolved_at=clock_timestamp()
            WHERE id=$1 AND state NOT IN ('SUCCESSFUL','FAILED','REVERSED','CANCELLED')`,
          [id, result.value.providerStatus ?? 'FAILED'],
        );
        break;
      case 'PENDING':
        await this.db.query(
          `UPDATE banking_outbound_operations SET provider_status=$2 WHERE id=$1 AND state=$3`,
          [id, result.value.providerStatus ?? 'PENDING', row.state],
        );
        break;
      case 'NOT_FOUND':
        // The provider has no record of our reference. That is *not* proof of failure — the reference
        // may not have propagated. It stays uncertain and goes to a human.
        await this.markUncertain(id, 'PROVIDER_HAS_NO_RECORD');
        break;
      case 'UNKNOWN':
      default:
        await this.markUncertain(id, 'STATUS_UNKNOWN');
        break;
    }
    return this.record(this.db.manager, id);
  }

  /**
   * Escalates an uncertain operation to a human.
   *
   * Deliberately accepts no target state. The caller cannot say "mark it successful": investigation
   * produces evidence, and evidence is recorded by a separate, governed process.
   */
  async escalateToReview(id: string, reason: string): Promise<OutboundRecordView> {
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      throw new Error('A review reason is required');
    }
    await this.db.query(
      `UPDATE banking_outbound_operations SET state='MANUAL_REVIEW',last_failure_code=$2
        WHERE id=$1 AND state IN ('UNKNOWN','PENDING_PROVIDER','PENDING_VERIFICATION')`,
      [id, reason.trim().slice(0, 64)],
    );
    return this.record(this.db.manager, id);
  }

  private async markUncertain(id: string, code: string): Promise<void> {
    await this.db.query(
      `UPDATE banking_outbound_operations
          SET state='UNKNOWN',last_failure_code=$2
        WHERE id=$1 AND state NOT IN ('SUCCESSFUL','FAILED','REVERSED','CANCELLED')`,
      [id, code.slice(0, 64)],
    );
  }

  private requireProvider(key: string): BankingProvider {
    const provider = this.registry.find(key);
    if (!provider) {
      throw new ServiceUnavailableException(`Banking provider ${key} is not configured`);
    }
    if (!this.registry.supports(key, 'OUTBOUND_TRANSFER_SUBMIT')) {
      // Never fall back to another provider. Rerouting after an uncertain operation is precisely the
      // failure this architecture exists to prevent.
      throw new ServiceUnavailableException(`Banking provider ${key} cannot submit transfers`);
    }
    return provider;
  }
}
