import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { DataSource } from 'typeorm';

import type { BankingProviderRegistry } from './banking-provider.registry';
import type { BankingReadinessService } from './banking-readiness.service';
import type { BankingVirtualAccountService } from './banking-virtual-account.service';

export type AgentFundingAccountState =
  | 'PROVISIONED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'NOT_PROVISIONED'
  | 'WALLET_NOT_AGENT_OWNED'
  | 'NO_INSTITUTION';

export interface AgentFundingAccountView {
  readonly state: AgentFundingAccountState;
  readonly agentId: string;
  readonly institutionId: string;
  readonly walletId: string;
  readonly providerKey: string;
  readonly currency: string;
  /** Deliberately fixed: an agent funding account receives float, never pays it out. */
  readonly purpose: 'AGENT_FLOAT_FUNDING';
  readonly accountNumber: string | null;
  readonly bankName: string | null;
  readonly accountName: string | null;
}

/**
 * The agent's provider-issued funding account: where an agent's float arrives from.
 *
 * This is a *receiving* instrument and nothing else. It exists because an agent's float has to come
 * from somewhere, and the honest source is a bank transfer into an account that is bound — at
 * provisioning time — to exactly one agent, one institution, one provider, one currency and one
 * purpose. Every one of those bindings is part of the account's identity; an account that could
 * receive on behalf of two agents, or into the wrong institution's float, is not a funding account, it
 * is an unattributed pool.
 *
 * What this service will not do, and why:
 *
 * - **It does not credit float.** The database cannot tell from a bank transfer alone that the money
 *   is float rather than a customer's cash-in. Crediting requires the inbound verification path, which
 *   proves the payment against the provider before anything is posted. This service provisions the
 *   account and reports what the provider confirmed; it never moves a balance.
 * - **It does not treat a provisioned account as funded.** `PROVISIONED` means the account exists at
 *   the provider. It says nothing about money.
 * - **It does not use the platform funding pool.** `AGENT_FUNDING_POOL-NGN` is unattributed by
 *   design and explicitly refuses to fund institution-attributed wallets; routing agent float through
 *   it would bypass that documented refusal.
 */
@Injectable()
export class BankingAgentFundingService {
  private readonly logger = new Logger(BankingAgentFundingService.name);

  constructor(
    private readonly db: DataSource,
    private readonly registry: BankingProviderRegistry,
    private readonly readiness: BankingReadinessService,
    private readonly accounts: BankingVirtualAccountService,
    private readonly environment: 'sandbox' | 'production',
  ) {}

  /**
   * The agent's funding account, or a state that says why there isn't one.
   *
   * Ownership is enforced here rather than by the caller: the wallet must be classified `AGENT` and
   * its owner reference must resolve to the requested agent. A customer wallet therefore cannot be
   * presented as an agent's funding account.
   */
  async view(agentId: string, walletId: string): Promise<AgentFundingAccountView> {
    const wallet = await this.requireAgentWallet(agentId, walletId);
    if (!wallet.institution_id) {
      // No institution means no approved provider configuration, so there is nothing to provision.
      return this.viewOf(agentId, wallet, 'NO_INSTITUTION');
    }
    const providerKey = await this.activeProviderKey(wallet.institution_id);
    if (!providerKey) return this.viewOf(agentId, wallet, 'NO_INSTITUTION');

    const accounts = await this.db.query<
      Array<{ account_number: string; account_name: string; bank_code: string }>
    >(
      `SELECT account_number,account_name,bank_code FROM virtual_accounts
        WHERE wallet_id=$1 AND provider=$2 AND status='ACTIVE'
        ORDER BY assigned_at DESC LIMIT 1`,
      [wallet.id, providerKey],
    );
    if (accounts[0]) {
      return {
        ...this.viewOf(agentId, wallet, 'PROVISIONED', providerKey),
        accountNumber: accounts[0].account_number,
        bankName: await this.bankName(accounts[0].bank_code),
        accountName: accounts[0].account_name,
      };
    }

    const reservations = await this.db.query<Array<{ outcome: string }>>(
      `SELECT outcome FROM banking_virtual_account_reservations
        WHERE wallet_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [wallet.id],
    );
    const outcome = reservations[0]?.outcome;
    const state: AgentFundingAccountState =
      outcome === 'UNKNOWN'
        ? 'UNKNOWN'
        : outcome === 'PENDING' || outcome === 'REQUESTED'
          ? 'PENDING'
          : 'NOT_PROVISIONED';
    return this.viewOf(agentId, wallet, state, providerKey);
  }

  /**
   * Provisions the funding account. Idempotent by wallet: a retry addresses the same reference, and the
   * underlying service refuses to submit while an earlier attempt is `UNKNOWN`.
   */
  async provision(agentId: string, walletId: string): Promise<AgentFundingAccountView> {
    const wallet = await this.requireAgentWallet(agentId, walletId);
    if (!wallet.institution_id) {
      throw new ForbiddenException('Agent wallet is not institution-attributed');
    }
    const providerKey = await this.activeProviderKey(wallet.institution_id);
    if (!providerKey) {
      throw new ServiceUnavailableException(
        'No banking provider is configured for this institution',
      );
    }
    const provider = this.registry.find(providerKey);
    if (!provider) {
      throw new ServiceUnavailableException('Banking provider is not registered');
    }
    const usable = await this.readiness.capabilityUsable(
      wallet.institution_id,
      providerKey,
      this.environment,
      'VIRTUAL_ACCOUNT_PROVISION',
    );
    if (!usable.usable) {
      // Refused with the state, never a guessed success.
      throw new ServiceUnavailableException(
        `Agent funding account provisioning unavailable: ${usable.state}`,
      );
    }

    const agentName = await this.agentDisplayName(agentId);
    const result = await this.accounts.provision({
      institutionId: wallet.institution_id,
      walletId: wallet.id,
      providerKey,
      environment: provider.descriptor.environment,
      // Derived from the wallet so a retry addresses the same account rather than creating a second.
      accountReference: `AGF${createHash('sha256').update(wallet.id).digest('hex').slice(0, 20).toUpperCase()}`,
      accountName: agentName,
      customerName: agentName,
      customerEmail: `agent-${agentId}@monienaija.invalid`,
      currency: wallet.currency,
      correlationId: `agentfund:${wallet.id}`,
    });
    this.logger.log(
      `Agent funding account provisioning for wallet ${wallet.id}: ${result.outcome}`,
    );
    return this.view(agentId, walletId);
  }

  /**
   * Verified funds received into an agent's funding account.
   *
   * Read-only, and derived from inbound payment records the provider confirmed. It reports what
   * arrived; it does not claim the float was credited, because crediting is a separate authorized
   * step. An agent asking "did my money arrive" gets an honest answer either way.
   */
  async receivedFunds(agentId: string, walletId: string, limit = 50) {
    const wallet = await this.requireAgentWallet(agentId, walletId);
    const rows = await this.db.query<
      Array<{
        id: string;
        provider_transaction_reference: string;
        credited_amount_minor: string;
        currency: string;
        paid_at: Date | null;
        recorded_at: Date;
        verification_state: string;
        posted: boolean;
      }>
    >(
      `SELECT p.id,p.provider_transaction_reference,p.credited_amount_minor::text AS credited_amount_minor,
              p.currency,p.paid_at,p.recorded_at,p.verification_state,
              (p.ledger_transaction_id IS NOT NULL) AS posted
         FROM banking_inbound_payments p
         JOIN virtual_accounts va ON va.account_number = p.receiving_account_number
        WHERE va.wallet_id=$1
        ORDER BY p.recorded_at DESC LIMIT $2`,
      [wallet.id, Math.min(Math.max(limit, 1), 200)],
    );
    return rows.map((row) => ({
      id: row.id,
      reference: row.provider_transaction_reference,
      amountMinor: row.credited_amount_minor,
      currency: row.currency,
      receivedAt: row.paid_at ?? row.recorded_at,
      state:
        row.verification_state === 'VERIFIED'
          ? row.posted
            ? ('FLOAT_CREDITED' as const)
            : ('VERIFIED_AWAITING_FLOAT_CREDIT' as const)
          : row.verification_state === 'REJECTED'
            ? ('REJECTED' as const)
            : ('CONFIRMING' as const),
    }));
  }

  private async requireAgentWallet(
    agentId: string,
    walletId: string,
  ): Promise<{
    id: string;
    currency: string;
    institution_id: string | null;
    status: string;
  }> {
    if (!/^[0-9a-f-]{36}$/i.test(walletId)) {
      throw new BadRequestException('walletId must be a UUID');
    }
    const rows = await this.db.query<
      Array<{ id: string; currency: string; institution_id: string | null; status: string }>
    >(
      // `wallet_accounts.customer_id` is the owner reference for agents too; the classification is
      // what distinguishes them, and both must agree.
      `SELECT id,currency,institution_id,status FROM wallet_accounts
        WHERE id=$1 AND customer_id=$2::text AND owner_class='AGENT'`,
      [walletId, agentId],
    );
    const wallet = rows[0];
    if (!wallet) {
      // Not this agent's wallet — indistinguishable from a wallet that does not exist.
      throw new NotFoundException('Agent wallet not found');
    }
    if (wallet.status !== 'ACTIVE') {
      throw new ConflictException('Agent wallet is not active');
    }
    return wallet;
  }

  /**
   * The single registered, usable provider for the institution.
   *
   * Exactly one: if two providers are configured for one institution, picking one would decide which
   * bank the agent's money lands in. That is an operator decision, not a runtime guess.
   */
  private async activeProviderKey(institutionId: string): Promise<string | null> {
    const usable: string[] = [];
    for (const provider of this.registry.list()) {
      const check = await this.readiness.capabilityUsable(
        institutionId,
        provider.descriptor.key,
        this.environment,
        'VIRTUAL_ACCOUNT_PROVISION',
      );
      if (check.usable) usable.push(provider.descriptor.key);
    }
    if (usable.length > 1) {
      this.logger.error(
        `Institution ${institutionId} has ${usable.length} usable banking providers; refusing to choose one for agent funding`,
      );
      return null;
    }
    return usable[0] ?? null;
  }

  private async agentDisplayName(agentId: string): Promise<string> {
    const rows = await this.db.query<Array<{ reference: string }>>(
      `SELECT reference FROM agents WHERE id=$1`,
      [agentId],
    );
    // The reference is the only guaranteed human-ish identifier; a profile name table is not
    // authoritative for agents and inventing a name would put it on a bank statement.
    return `Agent ${rows[0]?.reference ?? agentId}`;
  }

  private async bankName(code: string): Promise<string | null> {
    const rows = await this.db.query<Array<{ name: string }>>(
      'SELECT name FROM banks WHERE code=$1 LIMIT 1',
      [code],
    );
    return rows[0]?.name ?? null;
  }

  private viewOf(
    agentId: string,
    wallet: { id: string; currency: string; institution_id: string | null },
    state: AgentFundingAccountState,
    providerKey = '',
  ): AgentFundingAccountView {
    return {
      state,
      agentId,
      institutionId: wallet.institution_id ?? '',
      walletId: wallet.id,
      providerKey,
      currency: wallet.currency,
      purpose: 'AGENT_FLOAT_FUNDING',
      accountNumber: null,
      bankName: null,
      accountName: null,
    };
  }

  /** One outbound transfer for this agent, by our own operation reference (masked, owner-scoped). */
  async transferForAgent(agentId: string, operationReference: string) {
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
              o.destination_bank_code,o.destination_account_number,o.created_at,o.resolved_at,o.submitted_at
         FROM banking_outbound_operations o
         JOIN wallet_accounts w ON w.id=o.wallet_id
        WHERE w.customer_id=$1::text AND w.owner_class='AGENT' AND o.operation_reference=$2`,
      [agentId, operationReference],
    );
    const row = rows[0];
    if (!row) return null;
    const customerState =
      row.state === 'SUCCESSFUL'
        ? ('SUCCESSFUL' as const)
        : row.state === 'FAILED'
          ? ('REJECTED' as const)
          : row.state === 'REVERSED'
            ? ('REVERSED' as const)
            : row.state === 'CANCELLED'
              ? ('CANCELLED' as const)
              : row.state === 'PENDING_PROVIDER' || row.state === 'PENDING_VERIFICATION'
                ? ('PROCESSING' as const)
                : row.state === 'CREATED'
                  ? ('AUTHORIZED' as const)
                  : ('CONFIRMING' as const);
    return {
      operationReference: row.operation_reference,
      state: customerState,
      amountMinor: row.amount_minor,
      currency: row.currency,
      bankCode: row.destination_bank_code,
      accountNumberLast4: row.destination_account_number.slice(-4),
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      resolvedAt: row.resolved_at,
    };
  }

  /** Exposed for callers that must bind a float credit to the exact funding account. */
  async accountForWalletInTransaction(
    manager: EntityManager,
    walletId: string,
  ): Promise<{ accountNumber: string; providerKey: string } | null> {
    const rows = await manager.query<Array<{ account_number: string; provider: string }>>(
      `SELECT account_number,provider FROM virtual_accounts
        WHERE wallet_id=$1 AND status='ACTIVE' ORDER BY assigned_at DESC LIMIT 1`,
      [walletId],
    );
    return rows[0]
      ? { accountNumber: rows[0].account_number, providerKey: rows[0].provider }
      : null;
  }
}
