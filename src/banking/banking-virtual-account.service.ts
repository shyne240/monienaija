import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BankingProviderRegistry } from './banking-provider.registry';
import type {
  BankingProvider,
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
  /** Re-presented, verified BVN/NIN. Never written to the database; only digests are retained. */
  providerBvn?: string;
  providerNin?: string;
  bvnMac?: string;
  ninMac?: string;
  identityRevision?: string;
}

export interface IssuedAccount {
  bankCode: string;
  bankName: string | null;
  accountNumber: string;
  accountName: string;
  accountReference?: string;
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
    accounts: IssuedAccount[];
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
        // A retry must recover the original account, not an empty success. The database assignment
        // is authoritative; if a legacy row predates it, ask the provider by the SAME reference and
        // persist what it returns. No second provisioning submission is ever made here.
        const assigned = await this.assignedAccounts(command.walletId);
        if (assigned.length > 0) {
          return {
            reservationId: existing[0].id,
            outcome: 'ALREADY_PROVISIONED',
            unknownPending: false,
            accounts: assigned,
          };
        }
        const recovered = await this.recoverAssignedAccounts(command, provider);
        return {
          reservationId: existing[0].id,
          outcome: recovered.length > 0 ? 'ALREADY_PROVISIONED' : 'PENDING',
          unknownPending: false,
          accounts: recovered,
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
           outcome,request_fingerprint,attempts,last_attempted_at,
           bvn_mac,nin_mac,identity_revision)
         VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'REQUESTED',$7,1,clock_timestamp(),$8,$9,$10)
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
          // Digests only; the raw BVN/NIN exists only in the provider request that follows.
          command.bvnMac ?? null,
          command.ninMac ?? null,
          command.identityRevision ?? null,
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
          ...(command.providerBvn ? { providerBvn: command.providerBvn } : {}),
          ...(command.providerNin ? { providerNin: command.providerNin } : {}),
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
      const accounts = value.accounts.map((a) => ({
        bankCode: a.providerBankCode,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        accountName: a.accountName,
      }));
      await this.persistAssignment(command, accounts);
      await this.mark(reservationId, 'PROVISIONED', 'ACTIVE', value.providerReference ?? null);
      return { reservationId, outcome: 'PROVISIONED', unknownPending: false, accounts };
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

  /** Only one issued account is exposed: an inbound payment to an unpersisted alias would be unmatched. */
  private canonical(accounts: IssuedAccount[]) {
    return [...accounts].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))[0]!;
  }

  private async persistAssignment(
    command: ProvisionCommand,
    accounts: IssuedAccount[],
  ): Promise<void> {
    const account = this.canonical(accounts);
    await this.db.query(
      `INSERT INTO virtual_accounts
        (id,wallet_id,bank_code,account_number,account_name,provider,status,reference,assigned_at)
       VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,'ACTIVE',$6,clock_timestamp())
       ON CONFLICT ON CONSTRAINT uq_virtual_accounts_provider_number DO NOTHING`,
      [
        command.walletId,
        account.bankCode,
        account.accountNumber,
        account.accountName,
        command.providerKey,
        // The provider-issued reference is OUR durable account identity for webhook matching.
        command.accountReference,
      ],
    );
  }

  private async assignedAccounts(walletId: string): Promise<
    Array<{
      bankCode: string;
      bankName: string | null;
      accountNumber: string;
      accountName: string;
      accountReference?: string;
    }>
  > {
    const rows = await this.db.query<
      Array<{ account_number: string; bank_code: string; account_name: string; reference: string }>
    >(
      `SELECT account_number,bank_code,account_name,reference FROM virtual_accounts
        WHERE wallet_id=$1 AND provider='MONNIFY' AND status='ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1`,
      [walletId],
    );
    if (!rows[0]) return [];
    return [
      {
        bankCode: rows[0].bank_code,
        bankName: await this.bankNameOf(rows[0].bank_code),
        accountNumber: rows[0].account_number,
        accountName: rows[0].account_name,
        accountReference: rows[0].reference,
      },
    ];
  }

  private async recoverAssignedAccounts(
    command: ProvisionCommand,
    provider: BankingProvider,
  ): Promise<
    Array<{
      bankCode: string;
      bankName: string | null;
      accountNumber: string;
      accountName: string;
      accountReference?: string;
    }>
  > {
    if (!provider.getVirtualAccountStatus) return [];
    const result = await provider.getVirtualAccountStatus(command.accountReference, {
      correlationId: command.correlationId,
    });
    if (!result.ok || result.value.outcome !== 'ACTIVE' || result.value.accounts.length === 0) {
      return [];
    }
    const accounts = result.value.accounts.map((a) => ({
      bankCode: a.providerBankCode,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
    }));
    await this.persistAssignment(command, accounts);
    await this.markByIdentity(command, 'PROVISIONED', 'RECOVERED_BY_ENQUIRY');
    return [this.canonical(accounts)];
  }

  private async markByIdentity(
    command: ProvisionCommand,
    outcome: 'PROVISIONED' | 'REJECTED' | 'UNKNOWN' | 'PENDING',
    status: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE banking_virtual_account_reservations
          SET outcome=$2,provider_status=$3,updated_at=clock_timestamp()
        WHERE institution_id=$1 AND provider_key=$4 AND environment=$5 AND account_reference=$6`,
      [
        command.institutionId,
        outcome,
        status,
        command.providerKey,
        command.environment,
        command.accountReference,
      ],
    );
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

  // ------------------------------------------------------------------ customer reads

  /**
   * The customer's authoritative receiving account, or null.
   *
   * Ownership is enforced in the query, not by the caller: every predicate is scoped by
   * `customerId`, so a wallet id belonging to somebody else yields null — the same answer as a wallet
   * that does not exist. The controller turns that into a 404, which is the correct response because
   * a 403 would confirm the other customer's wallet exists.
   *
   * The four states are deliberately distinct and only one of them carries an account number:
   *
   * - `PROVISIONED` — a provider issued this account and it is active;
   * - `PENDING` — provisioning was requested and has not yet produced an account;
   * - `UNKNOWN` — an attempt was made and the outcome is not known; requesting again will not submit;
   * - `NOT_PROVISIONED` — no attempt exists.
   */
  async findForWallet(
    customerId: string,
    walletId: string,
  ): Promise<{
    state: 'PROVISIONED' | 'PENDING' | 'UNKNOWN' | 'NOT_PROVISIONED';
    accountNumber: string | null;
    bankName: string | null;
    accountName: string | null;
    providerSupportsProvisioning: boolean;
    /** Our stable account reference, reused for provider status enquiries and webhook matching. */
    accountReference: string | null;
  } | null> {
    const wallets = await this.db.query<Array<{ id: string }>>(
      // `wallet_accounts.customer_id` is a VARCHAR owner reference, not a UUID foreign key: the
      // platform's own reconciliation treats it as non-authoritative on its own. Comparing it to a
      // uuid raises `uuid = character varying`, and trusting it alone would let a legacy or
      // mis-typed reference grant ownership. Ownership therefore requires the classified owner to be
      // CUSTOMER *and* the reference to resolve to this customer's id.
      `SELECT id FROM wallet_accounts
        WHERE id=$1 AND customer_id=$2::text AND owner_class='CUSTOMER' AND status='ACTIVE'`,
      [walletId, customerId],
    );
    if (!wallets[0]) return null;

    const accounts = await this.db.query<
      Array<{ account_number: string; bank_code: string; account_name: string; reference: string }>
    >(
      `SELECT va.account_number,va.bank_code,va.account_name,va.reference
         FROM virtual_accounts va
        WHERE va.wallet_id=$1 AND va.status='ACTIVE'
        ORDER BY va.assigned_at DESC LIMIT 1`,
      [walletId],
    );
    if (accounts[0]) {
      return {
        state: 'PROVISIONED',
        accountNumber: accounts[0].account_number,
        bankName: await this.bankNameOf(accounts[0].bank_code),
        accountName: accounts[0].account_name,
        providerSupportsProvisioning: true,
        accountReference: accounts[0].reference,
      };
    }

    const reservations = await this.db.query<Array<{ outcome: string }>>(
      `SELECT outcome FROM banking_virtual_account_reservations
        WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [walletId],
    );
    const outcome = reservations[0]?.outcome;
    if (outcome === 'UNKNOWN') {
      return {
        state: 'UNKNOWN',
        accountNumber: null,
        bankName: null,
        accountName: null,
        providerSupportsProvisioning: true,
        accountReference: null,
      };
    }
    if (outcome === 'PENDING' || outcome === 'REQUESTED') {
      return {
        state: 'PENDING',
        accountNumber: null,
        bankName: null,
        accountName: null,
        providerSupportsProvisioning: true,
        accountReference: null,
      };
    }
    return {
      state: 'NOT_PROVISIONED',
      accountNumber: null,
      bankName: null,
      accountName: null,
      providerSupportsProvisioning: true,
      accountReference: null,
    };
  }

  /**
   * Eligibility and provider binding for a provisioning request.
   *
   * Returns null when the wallet is not the customer's. Eligibility is read from the wallet's
   * institution association plus an existing-account check rather than being asserted here: this
   * method gathers facts, and the controller refuses on them.
   */
  async customerProvisioningContext(
    customerId: string,
    walletId: string,
  ): Promise<{
    institutionId: string | null;
    currency: string;
    providerKey: string;
    accountReference: string;
    accountName: string;
    customerName: string;
    customerEmail: string;
    elegible: boolean;
  } | null> {
    const rows = await this.db.query<
      Array<{
        institution_id: string | null;
        currency: string;
        customer_reference: string;
        customer_status: string;
        display_name: string | null;
      }>
    >(
      // The customer's display name lives on `customer_profiles`, not on `customers`; there is no
      // email column on either. Addressability falls back to the platform's reserved domain, so no
      // real contact address is ever invented for a provider.
      `SELECT w.institution_id,w.currency,c.reference AS customer_reference,c.status AS customer_status,
              p.display_name
         FROM wallet_accounts w
         JOIN customers c ON c.id::text = lower(w.customer_id)
         LEFT JOIN customer_profiles p ON p.customer_id = c.id AND p.deleted_at IS NULL
        WHERE w.id=$1 AND w.customer_id=$2::text AND w.owner_class='CUSTOMER'
          AND w.status='ACTIVE' AND c.deleted_at IS NULL AND c.id::text=$3`,
      [walletId, customerId, customerId],
    );
    const row = rows[0];
    if (!row) return null;
    const customerName = (row.display_name ?? '').trim();
    return {
      institutionId: row.institution_id,
      currency: row.currency,
      // The provider is derived from configuration, not chosen by the customer.
      providerKey: 'MONNIFY',
      // A stable reference derived from the wallet, so a retried request addresses the same account
      // rather than creating a second one.
      // virtual_accounts.reference is constrained to MN + digits only. Convert the digest to a
      // decimal string so the same wallet always produces one valid, stable account reference.
      accountReference: `MN${BigInt(
        `0x${createHash('sha256').update(walletId).digest('hex').slice(0, 24)}`,
      )
        .toString()
        .padStart(28, '0')
        .slice(0, 24)}`,
      accountName: customerName.length > 0 ? customerName : `Customer ${row.customer_reference}`,
      customerName: customerName.length > 0 ? customerName : `Customer ${row.customer_reference}`,
      // There is no customer email on this platform. The `.invalid` TLD is reserved by RFC 2606 and
      // can never be delivered to, which is the honest representation of "no address available".
      customerEmail: `${row.customer_reference}@monienaija.invalid`,
      // Only an ACTIVE customer may be given a receiving account.
      elegible: row.customer_status === 'ACTIVE',
    };
  }

  /** Verified inbound deposits for one customer. Unverified claims are never shown as money. */
  async depositHistoryForCustomer(customerId: string, limit: number) {
    const rows = await this.db.query<
      Array<{
        id: string;
        business_reference: string | null;
        provider_transaction_reference: string;
        credited_amount_minor: string;
        customer_credit_minor: string | null;
        gross_amount_minor: string;
        provider_fee_minor: string;
        settlement_amount_minor: string | null;
        monienaija_fee_minor: string;
        currency: string;
        paid_at: Date | null;
        recorded_at: Date;
        verification_state: string;
        posted: boolean;
        exception_reason: string | null;
        permitted_next_action: string | null;
      }>
    >(
      `SELECT p.id,p.business_reference,p.provider_transaction_reference,
              p.credited_amount_minor::text AS credited_amount_minor,
              p.customer_credit_minor::text AS customer_credit_minor,
              p.gross_amount_minor::text AS gross_amount_minor,
              p.provider_fee_minor::text AS provider_fee_minor,
              p.settlement_amount_minor::text AS settlement_amount_minor,
              p.monienaija_fee_minor::text AS monienaija_fee_minor,
              p.currency,p.paid_at,p.recorded_at,p.verification_state,
              (p.credit_journal_id IS NOT NULL) AS posted,
              e.reason AS exception_reason,e.permitted_next_action
         FROM banking_inbound_payments p
         JOIN virtual_accounts va ON va.account_number = p.receiving_account_number
         JOIN wallet_accounts w ON w.id = va.wallet_id
         LEFT JOIN bank_to_wallet_credits c ON c.business_reference=p.business_reference
         LEFT JOIN bank_to_wallet_exceptions e ON e.business_reference=p.business_reference
        WHERE w.customer_id=$1::text AND w.owner_class='CUSTOMER'
        ORDER BY p.recorded_at DESC
        LIMIT $2`,
      [customerId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      businessReference: row.business_reference,
      reference: row.provider_transaction_reference,
      amountMinor: row.customer_credit_minor ?? row.credited_amount_minor,
      grossAmountMinor: row.gross_amount_minor,
      providerFeeMinor: row.provider_fee_minor,
      settlementAmountMinor: row.settlement_amount_minor,
      monienaijaFeeMinor: row.monienaija_fee_minor,
      currency: row.currency,
      receivedAt: row.paid_at ?? row.recorded_at,
      // Customer-safe vocabulary: an unverified claim is CONFIRMING, never "received". A withheld
      // payment is EXCEPTION with the reason and next action, never silently shown as a credit.
      state: row.exception_reason
        ? ('EXCEPTION' as const)
        : row.verification_state === 'VERIFIED'
          ? row.posted
            ? ('CREDITED' as const)
            : ('CONFIRMED_PENDING_CREDIT' as const)
          : row.verification_state === 'REJECTED'
            ? ('REJECTED' as const)
            : ('CONFIRMING' as const),
      exceptionReason: row.exception_reason,
      permittedNextAction: row.permitted_next_action,
    }));
  }

  /**
   * One outbound transfer for this customer, by our own operation reference.
   *
   * `CONFIRMING` is a distinct customer-facing state, and the mapping is deliberate: `UNKNOWN` and
   * `MANUAL_REVIEW` must never be rendered as a failure, because the money may well have moved.
   */
  async transferForCustomer(customerId: string, operationReference: string) {
    const rows = await this.db.query<
      Array<{
        operation_reference: string;
        state: string;
        amount_minor: string;
        currency: string;
        destination_bank_code: string;
        destination_account_number: string;
        created_at: Date;
        resolved_at: Date | null;
        submitted_at: Date | null;
      }>
    >(
      `SELECT o.operation_reference,o.state,o.amount_minor::text AS amount_minor,o.currency,
              o.destination_bank_code,o.destination_account_number,o.created_at,o.resolved_at,
              o.submitted_at
         FROM banking_outbound_operations o
         JOIN wallet_accounts w ON w.id = o.wallet_id
        WHERE w.customer_id=$1::text AND w.owner_class='CUSTOMER' AND o.operation_reference=$2`,
      [customerId, operationReference],
    );
    const row = rows[0];
    if (!row) return null;
    const state = row.state;
    const customerState =
      state === 'SUCCESSFUL'
        ? ('SUCCESSFUL' as const)
        : state === 'FAILED'
          ? ('REJECTED' as const)
          : state === 'REVERSED'
            ? ('REVERSED' as const)
            : state === 'CANCELLED'
              ? ('CANCELLED' as const)
              : state === 'PENDING_PROVIDER' || state === 'PENDING_VERIFICATION'
                ? ('PROCESSING' as const)
                : state === 'CREATED'
                  ? ('AUTHORIZED' as const)
                  : // UNKNOWN, SUBMITTING, MANUAL_REVIEW: the money may have moved. Never "failed".
                    ('CONFIRMING' as const);
    return {
      operationReference: row.operation_reference,
      state: customerState,
      amountMinor: row.amount_minor,
      currency: row.currency,
      bankCode: row.destination_bank_code,
      // The last four digits only: enough for the customer to recognise the transfer, not a full
      // destination record served back over an endpoint.
      accountNumberLast4: row.destination_account_number.slice(-4),
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      resolvedAt: row.resolved_at,
    };
  }

  private async bankNameOf(bankCode: string): Promise<string | null> {
    const rows = await this.db.query<Array<{ bank_name: string }>>(
      'SELECT bank_name FROM banks WHERE bank_code=$1 LIMIT 1',
      [bankCode],
    );
    return rows[0]?.bank_name ?? null;
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
