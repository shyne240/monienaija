import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { OutboxService } from '../operations/outbox.service';
import {
  AGENT_FLOAT_FUNDING_AUTHORITY,
  type AgentFloatDenialReason,
  type AgentFloatFundingAuthority,
} from './agent-float-funding-authority';

/**
 * Credits verified inbound funds as institution-attributed agent operating float.
 *
 * The gap this closes: `BankingAgentFundingService` provisions an account and reports
 * `VERIFIED_AWAITING_FLOAT_CREDIT`, and `AgentFundingService` refuses institution-attributed agents
 * because platform float is not an institutional funding authority. Between those two correct
 * refusals, no code path could raise an institution agent's float from a real bank transfer. This is
 * that path, and it closes the gap *without* relaxing either refusal.
 *
 * The journal, in words a controller would sign:
 *
 *     DEBIT   institution SETTLEMENT asset     (the institution's bank balance grew — the money
 *                                               arrived in its account at the provider)
 *     CREDIT  agent wallet ledger account      (the institution now owes the agent that float)
 *
 * Both legs are the same currency, the same institution and the same accounting unit. The credit leg
 * is the agent's *existing* wallet ledger account, so the agent's operating float is the wallet
 * balance — there is no parallel float balance to reconcile against it later.
 *
 * What it will not do:
 *
 * - It will not credit an account it did not issue for that agent, and it will not credit float under
 *   no policy. `AGENT_FUNDING_POOL-NGN` is never involved: it is an unattributed platform liability,
 *   and its refusal to fund attributed wallets is a documented guarantee, not an inconvenience.
 * - It will not credit production. A sandbox-approved policy proves the lifecycle; production needs an
 *   institution that has accepted settlement liability for float, which is not a row this service can
 *   write. Production attempts become durable obligations with `PRODUCTION_EXECUTION_WITHHELD`.
 * - It will not discard a verified payment it declines to credit. Every refusal writes an obligation
 *   row, which is what makes the difference between "the agent was suspended so we did not credit"
 *   and "we lost the payment".
 */
export interface AgentFloatFundingResult {
  readonly status: 'CREDITED' | 'OBLIGATION' | 'REPLAYED';
  readonly receiptId?: string;
  readonly journalId?: string;
  readonly obligationId?: string;
  readonly reason?: AgentFloatDenialReason;
}

const MAX_ATTEMPTS = 3;

@Injectable()
export class AgentFloatFundingService {
  private readonly logger = new Logger(AgentFloatFundingService.name);

  constructor(
    private readonly db: DataSource,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(AGENT_FLOAT_FUNDING_AUTHORITY)
    private readonly authority: AgentFloatFundingAuthority,
  ) {}

  /**
   * Funds an agent's float from a verified inbound payment.
   *
   * `providerReference` is the deduplication key at every layer: the receipt table's unique
   * constraint, the ledger's idempotency key derived from it, and this method's early replay check.
   * Calling it twice — after a duplicate webhook, from two workers, or after a restart — produces one
   * credit.
   */
  async fundFromVerifiedInbound(input: {
    institutionId: string;
    agentId: string;
    walletAccountId: string;
    fundingAccountNumber: string;
    providerKey: string;
    environment: 'sandbox' | 'production';
    providerReference: string;
    amountMinor: string;
    currency: string;
    correlationId: string;
    observedAt?: string | null;
  }): Promise<AgentFloatFundingResult> {
    const referenceHash = this.referenceHash(
      input.providerKey,
      input.environment,
      input.providerReference,
    );

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.db.transaction('SERIALIZABLE', (manager) =>
          this.creditInTransaction(manager, input, referenceHash),
        );
      } catch (error) {
        if (!this.isRetryable(error) || attempt === MAX_ATTEMPTS - 1) throw error;
        // Serialization failure: another transaction touched the same rows. Retry the whole unit of
        // work rather than a fragment of it — the uniqueness constraint, not this loop, is what makes
        // the credit exactly-once.
      }
    }
    throw new ServiceUnavailableException('Agent float funding could not be completed');
  }

  private async creditInTransaction(
    manager: EntityManager,
    input: {
      institutionId: string;
      agentId: string;
      walletAccountId: string;
      fundingAccountNumber: string;
      providerKey: string;
      environment: 'sandbox' | 'production';
      providerReference: string;
      amountMinor: string;
      currency: string;
      correlationId: string;
      observedAt?: string | null;
    },
    referenceHash: string,
  ): Promise<AgentFloatFundingResult> {
    // Serialize concurrent delivery of the same provider reference. The advisory lock is taken on the
    // reference, not the wallet, so two different payments to one agent do not queue behind each other.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `agentfloat:${referenceHash}`,
    ]);

    const existing = await manager.query<
      Array<{ id: string; journal_id: string; wallet_account_id: string; amount_minor: string }>
    >(
      `SELECT id::text AS id, journal_id::text AS journal_id,
              wallet_account_id::text AS wallet_account_id, amount_minor::text AS amount_minor
         FROM agent_float_funding_receipts
        WHERE provider_key = $1 AND environment = $2 AND provider_reference_hash = $3`,
      [input.providerKey, input.environment, referenceHash],
    );
    const prior = existing[0];
    if (prior) {
      // A genuine replay. But a replay that names a different wallet or amount is not the same
      // payment being retried — it is two different claims about one provider reference, and the
      // second must not silently adopt the first's credit.
      if (
        prior.wallet_account_id !== input.walletAccountId ||
        prior.amount_minor !== input.amountMinor
      ) {
        throw new ConflictException(
          'This provider reference was already credited with different terms; refusing to restate it',
        );
      }
      return { status: 'REPLAYED', receiptId: prior.id, journalId: prior.journal_id };
    }

    let decision;
    try {
      decision = await this.authority.authorize(manager, {
        institutionId: input.institutionId,
        agentId: input.agentId,
        walletAccountId: input.walletAccountId,
        fundingAccountNumber: input.fundingAccountNumber,
        providerKey: input.providerKey,
        environment: input.environment,
        providerReferenceHash: referenceHash,
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // The authority could not decide. Refuse; do not fall through to crediting.
      throw new ServiceUnavailableException('Agent float funding authority is unavailable');
    }
    if (decision.status === 'UNAVAILABLE') {
      throw new ServiceUnavailableException('Agent float funding authority is unavailable');
    }
    if (decision.status === 'DENIED') {
      // Not lost: preserved as an obligation operations can act on.
      const obligationId = await this.recordObligation(
        manager,
        input,
        referenceHash,
        decision.reason,
      );
      this.logger.warn(
        `Agent float not credited for ${input.providerKey} reference; obligation ${obligationId} (${decision.reason})`,
      );
      return { status: 'OBLIGATION', obligationId, reason: decision.reason };
    }

    // The float leg is the agent's own wallet ledger account. Resolve it through the wallet rather
    // than accepting an account id from the caller: the wallet is the thing the agent and institution
    // were bound to at attribution time.
    const wallets = await manager.query<
      Array<{ ledger_account_id: string; status: string; currency: string }>
    >(
      `SELECT ledger_account_id::text AS ledger_account_id, status, currency
         FROM wallet_accounts WHERE id = $1 FOR UPDATE`,
      [input.walletAccountId],
    );
    const wallet = wallets[0];
    if (!wallet) throw new ConflictException('Agent wallet disappeared during funding');
    if (wallet.status !== 'ACTIVE') {
      const obligationId = await this.recordObligation(
        manager,
        input,
        referenceHash,
        'AGENT_INELIGIBLE',
      );
      return { status: 'OBLIGATION', obligationId, reason: 'AGENT_INELIGIBLE' };
    }

    const receiptId = randomUUID();
    const journalId = await this.ledger.postJournalInTransaction(manager, {
      // Stable across retries and restarts for the same provider reference.
      idempotencyKey: `agentfloat:${this.referenceHash(input.providerKey, input.environment, referenceHash)}`,
      currency: input.currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: receiptId,
      description: 'Agent operating float funded from verified inbound payment',
      correlationId: input.correlationId,
      metadata: {
        agentFloatReceiptId: receiptId,
        agentId: input.agentId,
        institutionId: input.institutionId,
        providerKey: input.providerKey,
        providerReferenceHash: referenceHash,
        policyId: decision.policyId,
      },
      lines: [
        {
          // The institution's settlement asset grew: its money arrived in its account.
          accountId: decision.settlementAssetAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: input.amountMinor,
        },
        {
          // The institution now owes the agent that float.
          accountId: decision.floatAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: input.amountMinor,
        },
      ],
    });

    await manager.query(
      `INSERT INTO agent_float_funding_receipts
         (id, institution_id, agent_id, wallet_account_id, policy_id, provider_key, environment,
          provider_transaction_reference, provider_reference_hash, currency, amount_minor,
          funding_account_number, settlement_asset_account_id, float_account_id, journal_id,
          provider_observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        receiptId,
        input.institutionId,
        input.agentId,
        input.walletAccountId,
        decision.policyId,
        input.providerKey,
        input.environment,
        input.providerReference,
        referenceHash,
        input.currency,
        input.amountMinor,
        input.fundingAccountNumber,
        decision.settlementAssetAccountId,
        decision.floatAccountId,
        journalId,
        input.observedAt ?? null,
      ],
    );

    // If an earlier attempt left an open obligation for this reference, close it against the receipt
    // that now proves the credit. The trigger on the obligation table refuses this unless a receipt
    // actually exists, so this cannot be used to declare money moved that did not.
    await manager.query(
      `UPDATE agent_float_funding_obligations
          SET status = 'RESOLVED_CREDITED',
              resolution_evidence = jsonb_build_object('receiptId', $2::text, 'journalId', $3::text),
              resolved_at = clock_timestamp()
        WHERE provider_key = $1
          AND environment = $4
          AND provider_reference_hash = $5
          AND status IN ('OPEN','UNDER_REVIEW')`,
      [input.providerKey, receiptId, journalId, input.environment, referenceHash],
    );

    await this.audit.record(manager, {
      entityType: 'AGENT_FLOAT_FUNDING_RECEIPT',
      entityId: receiptId,
      action: 'AGENT_FLOAT_CREDITED',
      actor: 'system-agent-float-funding',
      correlationId: input.correlationId,
      newValues: {
        agentId: input.agentId,
        institutionId: input.institutionId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerKey: input.providerKey,
        providerReferenceHash: referenceHash,
        policyId: decision.policyId,
        journalId,
      },
    });
    await this.outbox.enqueue(manager, {
      eventType: 'AGENT_FLOAT_FUNDED',
      aggregateType: 'AGENT_FLOAT_FUNDING_RECEIPT',
      aggregateId: receiptId,
      payload: {
        agentId: input.agentId,
        institutionId: input.institutionId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        journalId,
      },
    });

    this.logger.log(
      `Agent float credited: ${input.amountMinor} ${input.currency} to agent ${input.agentId} (receipt ${receiptId})`,
    );
    return { status: 'CREDITED', receiptId, journalId };
  }

  private async recordObligation(
    manager: EntityManager,
    input: {
      institutionId: string;
      agentId: string;
      walletAccountId: string;
      fundingAccountNumber: string;
      providerKey: string;
      environment: 'sandbox' | 'production';
      providerReference: string;
      amountMinor: string;
      currency: string;
    },
    referenceHash: string,
    reason: AgentFloatDenialReason,
  ): Promise<string> {
    // The obligation names the agent and wallet *when they are real agents and wallets we hold*. A
    // denial such as `WALLET_NOT_AGENT_OWNED` means the "agentId" was in fact a customer, so writing
    // it here would violate the foreign key — and more importantly would assert a relationship that
    // does not exist. The payment is still preserved; only the attribution is left null.
    const agentExists = await manager.query<Array<{ id: string }>>(
      `SELECT id::text AS id FROM agents WHERE id = $1`,
      [input.agentId],
    );
    const walletExists = await manager.query<Array<{ id: string }>>(
      `SELECT id::text AS id FROM wallet_accounts WHERE id = $1`,
      [input.walletAccountId],
    );
    const rows = await manager.query<Array<{ id: string }>>(
      `INSERT INTO agent_float_funding_obligations
         (id, institution_id, agent_id, wallet_account_id, provider_key, environment,
          provider_transaction_reference, provider_reference_hash, currency, amount_minor,
          funding_account_number, reason)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (provider_key, environment, provider_reference_hash) DO UPDATE
         SET last_observed_at = clock_timestamp()
       RETURNING id::text AS id`,
      [
        input.institutionId,
        agentExists[0]?.id ?? null,
        walletExists[0]?.id ?? null,
        input.providerKey,
        input.environment,
        input.providerReference,
        referenceHash,
        input.currency,
        input.amountMinor,
        input.fundingAccountNumber,
        reason,
      ],
    );
    return rows[0]!.id;
  }

  /** Open obligations for operational review. Read-only: resolving one is a governed action. */
  async openObligations(institutionId: string, limit = 100) {
    return this.db.query<
      Array<{
        id: string;
        agent_id: string | null;
        provider_transaction_reference: string;
        currency: string;
        amount_minor: string;
        reason: string;
        status: string;
        first_observed_at: Date;
      }>
    >(
      `SELECT id::text AS id, agent_id::text AS agent_id, provider_transaction_reference,
              currency, amount_minor::text AS amount_minor, reason, status, first_observed_at
         FROM agent_float_funding_obligations
        WHERE institution_id = $1 AND status IN ('OPEN','UNDER_REVIEW')
        ORDER BY first_observed_at
        LIMIT $2`,
      [institutionId, Math.min(Math.max(limit, 1), 500)],
    );
  }

  private referenceHash(
    providerKey: string,
    environment: string,
    providerReference: string,
  ): string {
    // Stable, non-reversible binding of the provider's reference into our identifier space. Two
    // environments may legitimately reuse a reference, so the environment is part of the hash.
    return createHash('sha256')
      .update(`${providerKey}|${environment}|${providerReference}`)
      .digest('hex');
  }

  private isRetryable(error: unknown): boolean {
    const code = (error as { code?: string; driverError?: { code?: string } })?.code;
    const driverCode = (error as { driverError?: { code?: string } })?.driverError?.code;
    return code === '40001' || code === '40P01' || driverCode === '40001' || driverCode === '40P01';
  }
}
