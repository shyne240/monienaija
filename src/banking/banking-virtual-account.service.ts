import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { BankingProviderRegistry } from './banking-provider.registry';
import type {
  VirtualAccountProvisionResult,
  VirtualAccountStatusResult,
} from './banking-provider.types';

/**
 * Virtual-account provisioning, driven by the provider's answer rather than by our optimism.
 *
 * The one thing this service must never do is provision twice. An account that was created but not
 * reported back is indistinguishable, from outside, from one that was never created — so after an
 * `UNKNOWN` the service enquires by the *same* account reference and refuses to submit again while an
 * unknown reservation exists. The database enforces the refusal with a partial unique index; this
 * service simply respects it instead of working around it.
 *
 * What this service deliberately does not do:
 * - it does not invent a NUBAN. An account number exists because a provider issued it, and the only
 *   account numbers ever stored are the ones the provider returned;
 * - it does not write `virtual_accounts` for an unconfirmed provision, so a customer is never shown an
 *   account number that cannot receive money;
 * - it does not treat `REJECTED` and `UNKNOWN` as the same thing. One means "try a different
 *   approach"; the other means "find out what happened first".
 */

export interface ProvisionCommand {
  institutionId: string;
  walletId: string;
  providerKey: string;
  environment: 'sandbox' | 'production';
  accountReference: string;
  accountName: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  correlationId: string;
}

export interface ReservationView {
  id: string;
  account_reference: string;
  outcome: 'REQUESTED' | 'PROVISIONED' | 'PENDING' | 'UNKNOWN' | 'REJECTED';
  provider_status: string | null;
  provider_reservation_reference: string | null;
  attempts: number;
}

@Injectable()
export class BankingVirtualAccountService {
  private readonly logger = new Logger(BankingVirtualAccountService.name);

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
  ) {}

  async view(id: string): Promise<ReservationView> {
    const rows = await this.db.query<ReservationView[]>(
      `SELECT id,account_reference,outcome,provider_status,provider_reservation_reference,attempts
         FROM banking_virtual_account_reservations WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new Error('Virtual account reservation not found');
    return rows[0];
  }

  /** Raised when an earlier attempt left provisioning uncertain. */
  private async openUnknown(command: ProvisionCommand): Promise<ReservationView | null> {
    const rows = await this.db.query<ReservationView[]>(
      `SELECT id,account_reference,outcome,provider_status,provider_reservation_reference,attempts
         FROM banking_virtual_account_reservations
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3 AND wallet_id=$4
          AND outcome='UNKNOWN'
        LIMIT 1`,
      [command.institutionId, command.providerKey, command.environment, command.walletId],
    );
    return rows[0] ?? null;
  }

  /**
   * Provisions through the provider.
   *
   * Returns the existing reservation without calling the provider when an earlier attempt is still
   * `UNKNOWN` — enquire first, submit never.
   */
  async provision(command: ProvisionCommand): Promise<{
    reservationId: string;
    outcome: ReservationView['outcome'] | 'ALREADY_PROVISIONED';
    unknownPending: boolean;
    accounts: Array<{
      bankCode: string;
      bankName: string;
      accountNumber: string;
      accountName: string;
    }>;
  }> {
    const unknown = await this.openUnknown(command);
    if (unknown) {
      // Deliberately no provider call. A second submission could create a second account, and the
      // customer would then have two NUBANs neither of which we can safely retire.
      this.logger.warn(
        `Provisioning blocked: reservation ${unknown.account_reference} is still UNKNOWN`,
      );
      return {
        reservationId: unknown.id,
        outcome: 'UNKNOWN',
        unknownPending: true,
        accounts: [],
      };
    }

    const provider = this.registry.find(command.providerKey);
    if (!provider || !this.registry.supports(command.providerKey, 'VIRTUAL_ACCOUNT_PROVISION')) {
      throw new Error(`Provider ${command.providerKey} cannot provision virtual accounts`);
    }

    const existing = await this.db.query<Array<{ id: string; outcome: string }>>(
      `SELECT id,outcome FROM banking_virtual_account_reservations
        WHERE institution_id=$1 AND provider_key=$2 AND environment=$3 AND account_reference=$4`,
      [command.institutionId, command.providerKey, command.environment, command.accountReference],
    );

    let reservationId: string;
    if (existing[0]) {
      if (existing[0].outcome === 'PROVISIONED') {
        return {
          reservationId: existing[0].id,
          outcome: 'ALREADY_PROVISIONED',
          unknownPending: false,
          accounts: [],
        };
      }
      reservationId = existing[0].id;
      await this.db.query(
        `UPDATE banking_virtual_account_reservations
            SET attempts=attempts+1,last_attempted_at=clock_timestamp()
          WHERE id=$1`,
        [reservationId],
      );
    } else {
      const created = await this.db.query<Array<{ id: string }>>(
        `INSERT INTO banking_virtual_account_reservations
          (id,institution_id,wallet_id,provider_key,environment,account_reference,currency,
           outcome,request_fingerprint,attempts,last_attempted_at)
         VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'REQUESTED',$7,1,clock_timestamp())
         RETURNING id`,
        [
          command.institutionId,
          command.walletId,
          command.providerKey,
          command.environment,
          command.accountReference,
          command.currency,
          // A stable digest of the request, so a resumed attempt can prove it is the same request.
          createHash('sha256')
            .update(
              `${command.institutionId}|${command.walletId}|${command.accountReference}|${command.currency}`,
            )
            .digest('hex'),
        ],
      );
      reservationId = created[0]!.id;
    }

    let result;
    try {
      result = await provider.provisionVirtualAccount!(
        {
          accountReference: command.accountReference,
          accountName: command.accountName,
          customerName: command.customerName,
          customerEmail: command.customerEmail,
          currency: command.currency,
          correlationId: command.correlationId,
        },
        { correlationId: command.correlationId },
      );
    } catch {
      await this.mark(reservationId, 'UNKNOWN', 'ADAPTER_THREW');
      return { reservationId, outcome: 'UNKNOWN', unknownPending: true, accounts: [] };
    }

    if (!result.ok) {
      const rejected =
        result.error.category === 'PROVIDER_REJECTED' || result.error.category === 'VALIDATION';
      await this.mark(reservationId, rejected ? 'REJECTED' : 'UNKNOWN', result.error.code);
      return {
        reservationId,
        outcome: rejected ? 'REJECTED' : 'UNKNOWN',
        unknownPending: !rejected,
        accounts: [],
      };
    }

    const value: VirtualAccountProvisionResult = result.value;
    if (value.outcome === 'PROVISIONED' && value.accounts.length > 0) {
      await this.mark(reservationId, 'PROVISIONED', 'ACTIVE', value.providerReference ?? null);
      return {
        reservationId,
        outcome: 'PROVISIONED',
        unknownPending: false,
        accounts: value.accounts.map((a) => ({
          bankCode: a.providerBankCode,
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          accountName: a.accountName,
        })),
      };
    }
    if (value.outcome === 'REJECTED') {
      await this.mark(reservationId, 'REJECTED', 'REJECTED');
      return { reservationId, outcome: 'REJECTED', unknownPending: false, accounts: [] };
    }
    // PENDING or UNKNOWN: no account details were issued, so nothing is shown to a customer.
    const uncertain = value.outcome === 'UNKNOWN';
    await this.mark(reservationId, uncertain ? 'UNKNOWN' : 'PENDING', value.outcome);
    return {
      reservationId,
      outcome: uncertain ? 'UNKNOWN' : 'PENDING',
      unknownPending: uncertain,
      accounts: [],
    };
  }

  /** Resolves a reservation by asking the provider, without ever submitting again. */
  async enquire(
    reservationId: string,
    correlationId: string,
  ): Promise<{ outcome: ReservationView['outcome']; accounts: Array<{ accountNumber: string }> }> {
    const rows = await this.db.query<
      Array<{ provider_key: string; account_reference: string; outcome: string }>
    >(
      'SELECT provider_key,account_reference,outcome FROM banking_virtual_account_reservations WHERE id=$1',
      [reservationId],
    );
    const row = rows[0];
    if (!row) throw new Error('Virtual account reservation not found');
    const provider = this.registry.find(row.provider_key);
    if (!provider || !this.registry.supports(row.provider_key, 'VIRTUAL_ACCOUNT_STATUS')) {
      return { outcome: row.outcome as ReservationView['outcome'], accounts: [] };
    }
    let result;
    try {
      result = await provider.getVirtualAccountStatus!(row.account_reference, { correlationId });
    } catch {
      return { outcome: row.outcome as ReservationView['outcome'], accounts: [] };
    }
    if (!result.ok) return { outcome: row.outcome as ReservationView['outcome'], accounts: [] };
    const value: VirtualAccountStatusResult = result.value;
    if (value.outcome === 'ACTIVE' && value.accounts.length > 0) {
      await this.mark(reservationId, 'PROVISIONED', 'ACTIVE');
      return {
        outcome: 'PROVISIONED',
        accounts: value.accounts.map((a) => ({ accountNumber: a.accountNumber })),
      };
    }
    return { outcome: row.outcome as ReservationView['outcome'], accounts: [] };
  }

  private async mark(
    reservationId: string,
    outcome: ReservationView['outcome'],
    providerStatus: string,
    reservationReference: string | null = null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE banking_virtual_account_reservations
          SET outcome=$2,provider_status=$3,
              provider_reservation_reference=COALESCE($4,provider_reservation_reference),
              last_failure_code=CASE WHEN $2::varchar IN ('REJECTED','UNKNOWN')
                                     THEN $3::varchar ELSE NULL END,
              updated_at=clock_timestamp()
        WHERE id=$1`,
      [reservationId, outcome, providerStatus.slice(0, 64), reservationReference],
    );
  }
}
