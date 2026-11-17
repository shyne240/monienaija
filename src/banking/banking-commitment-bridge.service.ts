import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { BankingProviderRegistry } from './banking-provider.registry';

/**
 * The seam between an authorized A6 commitment and a provider dispatch.
 *
 * A commitment is created inside one SERIALIZABLE transaction that already holds the wallet lock,
 * the limit reservation, the withdrawal row, the external operation, the reservation journal and the
 * destination binding. The banking record is created **inside that same transaction**, so there is no
 * window in which a commitment is authorized but has no dispatch intent, and no window in which a
 * dispatch intent exists for a commitment that did not commit.
 *
 * That atomicity is the reason this is a bridge rather than an event handler: an event would introduce
 * exactly the gap that duplicate dispatch comes from.
 *
 * The operation reference is derived from the external operation id, which A6 already made unique per
 * commitment and replay-protected by idempotency key. Deriving it means a replayed commitment derives
 * the same reference and the unique index makes a second row impossible, rather than relying on the
 * caller to remember.
 */
@Injectable()
export class BankingCommitmentBridgeService {
  private readonly logger = new Logger(BankingCommitmentBridgeService.name);

  constructor(private readonly registry: BankingProviderRegistry) {}

  /**
   * Creates the durable dispatch intent. Idempotent by construction: the derived reference plus the
   * unique constraint mean calling it twice is a no-op, and the second call returns the existing row.
   */
  async createDispatchIntentInTransaction(
    manager: EntityManager,
    input: {
      institutionId: string | null;
      providerKey: string;
      environment: 'sandbox' | 'production';
      externalOperationId: string;
      externalOperationReference: string;
      walletId: string;
      currency: string;
      amountMinor: string;
      destinationBankCode: string;
      destinationAccountNumber: string;
      destinationAccountName: string | null;
    },
  ): Promise<{ id: string; operationReference: string; created: boolean } | null> {
    // A6 is a general financial-commitment engine and is not only used for bank settlement. If the
    // authorized provider is not a registered banking provider, this commitment is not a banking
    // dispatch and must not get a banking record: creating one would put a row in the dispatch
    // worklist for an operation no banking worker can submit.
    if (!this.registry.find(input.providerKey)) {
      this.logger.debug(`No banking dispatch record for non-banking provider ${input.providerKey}`);
      return null;
    }
    if (!input.institutionId) {
      // A banking provider was authorized for a wallet with no institution. The execution authority
      // refuses that combination, so reaching here means the two disagree — fail loudly rather than
      // write a record that could never be dispatched or attributed.
      throw new Error('Banking dispatch intent requires an institution-attributed wallet');
    }
    const operationReference = this.deriveReference(input.externalOperationId);
    const inserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO banking_outbound_operations
        (institution_id,provider_key,environment,operation_reference,external_operation_id,wallet_id,
         currency,amount_minor,destination_bank_code,destination_account_number,
         destination_account_name,state)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CREATED')
       ON CONFLICT (institution_id,provider_key,environment,operation_reference) DO NOTHING
       RETURNING id`,
      [
        input.institutionId,
        input.providerKey,
        input.environment,
        operationReference,
        input.externalOperationId,
        input.walletId,
        input.currency,
        input.amountMinor,
        input.destinationBankCode,
        input.destinationAccountNumber,
        input.destinationAccountName,
      ],
    );
    if (inserted[0]) {
      return { id: inserted[0].id, operationReference, created: true };
    }
    const existing = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM banking_outbound_operations
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3 AND operation_reference=$4`,
      [input.institutionId, input.providerKey, input.environment, operationReference],
    );
    if (!existing[0]) {
      // The insert conflicted but no row is visible: something is badly wrong, and proceeding would
      // mean dispatching an operation we cannot address afterwards.
      throw new Error('Banking dispatch intent could not be created or resolved');
    }
    return { id: existing[0].id, operationReference, created: false };
  }

  /**
   * Copies an authoritative provider outcome onto the A6 external operation lifecycle.
   *
   * Deliberately does not settle. Settlement is `ExternalSettlementService`'s job, which independently
   * re-checks the verification evidence before any journal is posted. Recording the observation here
   * and settling there keeps one writer per concern.
   */
  async recordObservation(
    manager: EntityManager,
    input: {
      bankingOperationId: string;
      state: 'PENDING_PROVIDER' | 'UNKNOWN' | 'MANUAL_REVIEW';
      providerStatus: string | null;
    },
  ): Promise<void> {
    await manager.query(
      `UPDATE banking_outbound_operations
          SET state=$2,provider_status=COALESCE($3,provider_status)
        WHERE id=$1 AND state NOT IN ('SUCCESSFUL','FAILED','REVERSED','CANCELLED')`,
      [input.bankingOperationId, input.state, input.providerStatus],
    );
  }

  /**
   * Deterministic, and a UUID-shaped hex digest rather than a random id, so the same commitment always
   * addresses the same provider operation.
   */
  private deriveReference(externalOperationId: string): string {
    return `OP${createHash('sha256').update(externalOperationId).digest('hex').slice(0, 30).toUpperCase()}`;
  }
}
