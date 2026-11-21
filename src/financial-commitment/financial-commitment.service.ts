import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { PasswordHashAlgorithm } from '../customer-authentication/customer-authentication.enums';
import { AuthenticationSessionService } from '../customer-authentication/authentication-session.service';
import { PasswordHashVerificationService } from '../customer-authentication/password-hash-verification.service';
import { CustomerTransactionPinService } from '../customer/customer-transaction-pin.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { LimitEnforcementService } from '../limit-catalog/limit-enforcement.service';
import { isRetryableTransactionError } from '../payment/payment-support';
import { ExternalOperationResourceType } from '../partner/external-operation.enums';
import { ExternalOperationService } from '../partner/external-operation.service';
import { WithdrawalService } from '../withdrawal/withdrawal.service';
import { WalletFinancialBoundaryService } from '../wallet/wallet-financial-boundary.service';
import { BankingCommitmentBridgeService } from '../banking/banking-commitment-bridge.service';
import { BankingFeeBindingService } from '../banking/banking-fee-binding.service';
import { AgentTransactionAuthorizationService } from '../agent/agent-transaction-authorization.service';
import { AgentService } from '../agent/agent-service.enum';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { OutboxService } from '../operations/outbox.service';
import {
  WITHDRAWAL_EXECUTION_AUTHORITY,
  type WithdrawalExecutionAuthority,
} from './withdrawal-execution-authority';
import {
  FinancialCommitmentRepository,
  type FinancialCommitmentRecord,
} from './financial-commitment.repository';

export interface InitiateFinancialCommitment {
  /** A real customer session token; never persisted. */
  token: string;
  /** Customer transaction PIN; never persisted. */
  pin: string;
  walletAccountId: string;
  amountMinor: string;
  currency: string;
  /** Customer-owned bank beneficiary selected by the authenticated principal. */
  beneficiaryId: string;
  idempotencyKey: string;
}

export interface InitiateAgentBankTransferCommitment {
  /** The authenticated agent. Taken from the session principal, never from request input. */
  agentId: string;
  /** The authenticated agent's session id (from the principal), re-validated inside the transaction. */
  agentSessionId: string;
  /** The authenticated AGENT principal, for class-of-service capability binding. */
  principal: AuthorizationPrincipal;
  /** Agent transaction PIN; never persisted. */
  pin: string;
  /**
   * Optional locator. When present it must identify the agent's own operating wallet; when absent the
   * operating wallet is resolved from the agent's authority (exactly one ACTIVE NGN operating wallet).
   */
  walletAccountId?: string;
  amountMinor: string;
  currency: string;
  /** Agent-owned bank beneficiary selected by the authenticated principal. */
  beneficiaryId: string;
  idempotencyKey: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal lane plan shared by both participant types; produced by the lane-specific initiators. */
interface ParticipantPlan {
  kind: 'CUSTOMER' | 'AGENT';
  /** Owner reference: customer id on the customer lane, agent id on the agent lane. */
  id: string;
  sessionId: string;
  pinAuditId: string;
  /** Agent class at authorization time; null on the customer lane. */
  agentClassId: string | null;
  walletId: string;
  amountMinor: string;
  currency: string;
  target: string;
  beneficiaryId: string;
  scopedKey: string;
  requestHash: string;
}

/** Internal orchestration only; deliberately not exposed through an HTTP controller. */
@Injectable()
export class FinancialCommitmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: AuthenticationSessionService,
    private readonly pins: CustomerTransactionPinService,
    private readonly verifier: PasswordHashVerificationService,
    private readonly walletBoundary: WalletFinancialBoundaryService,
    private readonly limits: LimitEnforcementService,
    private readonly withdrawals: WithdrawalService,
    private readonly operations: ExternalOperationService,
    private readonly ledger: LedgerService,
    private readonly commitments: FinancialCommitmentRepository,
    @Inject(WITHDRAWAL_EXECUTION_AUTHORITY)
    private readonly authority: WithdrawalExecutionAuthority,
    private readonly bankingBridge: BankingCommitmentBridgeService,
    private readonly fees: BankingFeeBindingService,
    private readonly agentAuthorization: AgentTransactionAuthorizationService,
    @Inject(OutboxService) @Optional() private readonly outboxService?: OutboxService,
  ) {}

  async initiate(input: InitiateFinancialCommitment): Promise<{
    commitment: FinancialCommitmentRecord;
    replayed: boolean;
    /**
     * The banking dispatch operation reference, when a banking dispatch intent exists. Null for
     * services that authorize a non-banking provider; never a fabricated value.
     */
    operationReference: string | null;
  }> {
    const initiated = await this.initiateCustomerOnce(input);
    const operationReference = await this.lookupBankingOperationReference(
      initiated.commitment.external_operation_id,
    );
    return { ...initiated, operationReference };
  }

  /**
   * Agent-self initiation of an external bank transfer from the operating wallet.
   *
   * The operating wallet is resolved from the authenticated agent's authority — a caller cannot
   * nominate somebody else's wallet, and when omitted the agent's single ACTIVE NGN operating
   * wallet is used. The commitment, reservation, ledger posting, fee binding, destination
   * binding, provider dispatch intent and settlement effects are the same shared architecture
   * the customer lane uses; only the principal, session and PIN authority differ.
   */
  async resolveCustomerIdFromToken(token: string): Promise<string> {
    const session = await this.sessions.validate({ token, audience: 'customer-api' });
    if (!session.valid || !session.principal?.customerId)
      throw new UnauthorizedException('Customer session is invalid');
    return session.principal.customerId;
  }

  async initiateForAgent(input: InitiateAgentBankTransferCommitment): Promise<{
    commitment: FinancialCommitmentRecord;
    replayed: boolean;
    /** Null when no banking dispatch intent exists; never a fabricated value. */
    operationReference: string | null;
  }> {
    const initiated = await this.initiateAgentOnce(input);
    const operationReference = await this.lookupBankingOperationReference(
      initiated.commitment.external_operation_id,
    );
    return { ...initiated, operationReference };
  }

  private async initiateCustomerOnce(
    input: InitiateFinancialCommitment,
  ): Promise<{ commitment: FinancialCommitmentRecord; replayed: boolean }> {
    const session = await this.sessions.validate({ token: input.token, audience: 'customer-api' });
    if (!session.valid || !session.principal)
      throw new UnauthorizedException('Customer session is invalid');
    const principal = session.principal;
    const walletId = input.walletAccountId.trim().toLowerCase();
    if (!UUID_PATTERN.test(walletId))
      throw new BadRequestException('walletAccountId must be a UUID');
    const amountMinor = parsePositiveMinorUnits(input.amountMinor).toString();
    const currency = normalizeCurrency(input.currency);
    if (currency !== 'NGN') throw new BadRequestException('Only NGN withdrawals are supported');
    const beneficiaryId = input.beneficiaryId.trim().toLowerCase();
    if (!UUID_PATTERN.test(beneficiaryId))
      throw new BadRequestException('beneficiaryId must be a UUID');
    const destination = await this.dataSource.transaction((manager) =>
      this.resolveDestination(manager, principal.customerId, beneficiaryId),
    );
    const target = destination.targetReference;
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 255) throw new BadRequestException('Idempotency key is required');
    const scopedKey = `withdrawal-commitment:${this.hash(`${principal.customerId}:${key}`)}`;
    const requestHash = this.hash(
      JSON.stringify({ customerId: principal.customerId, walletId, amountMinor, currency, target }),
    );
    if (typeof input.pin !== 'string' || !/^\d{4,12}$/.test(input.pin))
      throw new UnauthorizedException('Invalid customer PIN');
    const pin = await this.pins.verifyTransactionPin(
      principal.customerId,
      {
        pin: input.pin,
        actor: principal.customerId,
        financialBinding: { requestHash, sessionId: principal.sessionId },
      },
      {
        verify: (candidate, algorithm, hash) =>
          this.verifier.verify(candidate, algorithm as PasswordHashAlgorithm, hash),
      },
    );
    if (!pin.verified || !pin.auditId)
      throw new UnauthorizedException('Customer PIN verification failed');
    const plan: ParticipantPlan = {
      kind: 'CUSTOMER',
      id: principal.customerId,
      sessionId: principal.sessionId,
      pinAuditId: pin.auditId,
      agentClassId: null,
      walletId,
      amountMinor,
      currency,
      target,
      beneficiaryId,
      scopedKey,
      requestHash,
    };
    return this.commitWithRetry(plan);
  }

  private async initiateAgentOnce(
    input: InitiateAgentBankTransferCommitment,
  ): Promise<{ commitment: FinancialCommitmentRecord; replayed: boolean }> {
    const agentId = input.agentId.trim().toLowerCase();
    if (!UUID_PATTERN.test(agentId)) throw new BadRequestException('agentId must be a UUID');
    const sessionId = input.agentSessionId?.trim().toLowerCase();
    if (!sessionId || !UUID_PATTERN.test(sessionId))
      throw new UnauthorizedException('Agent session required');
    const amountMinor = parsePositiveMinorUnits(input.amountMinor).toString();
    const currency = normalizeCurrency(input.currency);
    if (currency !== 'NGN') throw new BadRequestException('Only NGN bank transfers are supported');
    const beneficiaryId = input.beneficiaryId.trim().toLowerCase();
    if (!UUID_PATTERN.test(beneficiaryId))
      throw new BadRequestException('beneficiaryId must be a UUID');

    // The operating wallet comes from the agent's authority. A caller cannot nominate a wallet
    // that belongs to anyone else; when nothing is nominated there must be exactly one ACTIVE
    // NGN operating wallet for the resolution to be unambiguous.
    const walletRows = await this.dataSource.query<
      Array<{ id: string; institution_id: string | null }>
    >(
      `SELECT id, institution_id FROM wallet_accounts
       WHERE customer_id=$1 AND owner_class='AGENT' AND status='ACTIVE' AND currency=$2`,
      [agentId, currency],
    );
    let wallet = walletRows[0];
    if (input.walletAccountId !== undefined) {
      const requested = input.walletAccountId.trim().toLowerCase();
      if (!UUID_PATTERN.test(requested))
        throw new BadRequestException('walletAccountId must be a UUID');
      const owned = walletRows.find((row) => row.id === requested);
      if (!owned) throw new ConflictException('walletAccountId is not the agent operating wallet');
      wallet = owned;
    } else if (walletRows.length !== 1) {
      throw new ConflictException(
        'Agent operating wallet resolution requires exactly one ACTIVE NGN operating wallet',
      );
    }
    const walletId = wallet!.id;

    const destination = await this.dataSource.transaction((manager) =>
      this.resolveAgentDestination(manager, agentId, beneficiaryId),
    );
    const target = destination.targetReference;
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 255) throw new BadRequestException('Idempotency key is required');
    const scopedKey = `withdrawal-commitment:${this.hash(`AGENT|${agentId}|${key}`)}`;
    const requestHash = this.hash(
      JSON.stringify({ agentId, walletId, amountMinor, currency, target }),
    );
    if (typeof input.pin !== 'string' || !/^\d{4,12}$/.test(input.pin))
      throw new UnauthorizedException('Invalid agent PIN');
    const authorization = await this.agentAuthorization.authorize({
      agentId,
      service: AgentService.EXTERNAL_BANK_TRANSFER,
      pin: input.pin,
      principal: input.principal,
      actor: agentId,
      financialBinding: { requestHash, sessionId },
    });
    if (!authorization.allowed || !authorization.context?.pinAuditId) {
      const reason = authorization.reason;
      if (
        reason === 'PIN_REQUIRED' ||
        reason === 'PIN_INVALID' ||
        reason === 'PIN_NOT_FOUND' ||
        reason === 'PIN_LOCKED' ||
        reason === 'PIN_POLICY_VIOLATION'
      )
        throw new UnauthorizedException(`Agent PIN authorization failed: ${reason}`);
      throw new ForbiddenException(`Agent bank transfer is not authorized: ${reason}`);
    }
    const plan: ParticipantPlan = {
      kind: 'AGENT',
      id: agentId,
      sessionId,
      pinAuditId: authorization.context.pinAuditId,
      agentClassId: authorization.context.agentClassId ?? null,
      walletId,
      amountMinor,
      currency,
      target,
      beneficiaryId,
      scopedKey,
      requestHash,
    };
    return this.commitWithRetry(plan);
  }

  private async commitWithRetry(
    plan: ParticipantPlan,
  ): Promise<{ commitment: FinancialCommitmentRecord; replayed: boolean }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.initiateWithin(manager, plan),
        );
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Commitment transaction could not complete');
  }

  /**
   * Resolves the banking dispatch operation reference created by the commitment bridge, if any.
   * A missing row is a real answer (a non-banking authorization exists), not an error; an
   * ambiguous answer indicates corrupted state and is refused rather than guessed.
   */
  /**
   * Lookup a commitment by the caller-provided raw idempotency key (hashed to scoped form).
   * Returns null if no commitment was ever created for that logical attempt — which is
   * authoritative: no duplicate can exist if nothing was ever persisted.
   * A failed lookup (exception) is not a 404 — it is an ambiguous recovery state and must
   * fail closed.
   */
  async lookupByIdempotencyForCustomer(
    customerId: string,
    rawIdempotencyKey: string,
  ): Promise<{ commitment: FinancialCommitmentRecord; operationReference: string | null } | null> {
    const key = rawIdempotencyKey.trim();
    if (!key || key.length > 255) throw new BadRequestException('idempotencyKey is required');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId))
      throw new BadRequestException('customerId is required');
    const scoped = `withdrawal-commitment:${this.hash(`${customerId}:${key}`)}`;
    const rows = await this.dataSource.query<FinancialCommitmentRecord[]>(
      `SELECT * FROM financial_commitments WHERE idempotency_key=$1 LIMIT 1`,
      [scoped],
    );
    const commitment = rows[0];
    if (!commitment) return null;
    // Verify ownership: the commitment's authorization must belong to this customer/principal.
    const authRows = await this.dataSource.query<Array<{ customer_id: string }>>(
      `SELECT customer_id FROM financial_authorizations WHERE id=$1`,
      [commitment.authorization_id],
    );
    if (!authRows[0] || authRows[0].customer_id !== customerId) return null;
    const opRef = await this.lookupBankingOperationReference(commitment.external_operation_id);
    return { commitment, operationReference: opRef };
  }

  async lookupByIdempotencyForAgent(
    agentId: string,
    rawIdempotencyKey: string,
  ): Promise<{ commitment: FinancialCommitmentRecord; operationReference: string | null } | null> {
    const key = rawIdempotencyKey.trim();
    if (!key || key.length > 255) throw new BadRequestException('idempotencyKey is required');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId))
      throw new BadRequestException('agentId is required');
    const scoped = `withdrawal-commitment:${this.hash(`AGENT|${agentId}|${key}`)}`;
    const rows = await this.dataSource.query<FinancialCommitmentRecord[]>(
      `SELECT * FROM financial_commitments WHERE idempotency_key=$1 LIMIT 1`,
      [scoped],
    );
    const commitment = rows[0];
    if (!commitment) return null;
    const authRows = await this.dataSource.query<Array<{ agent_id: string }>>(
      `SELECT agent_id FROM financial_authorizations WHERE id=$1`,
      [commitment.authorization_id],
    );
    if (!authRows[0] || authRows[0].agent_id !== agentId) return null;
    const opRef = await this.lookupBankingOperationReference(commitment.external_operation_id);
    return { commitment, operationReference: opRef };
  }

  private async lookupBankingOperationReference(
    externalOperationId: string,
  ): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ operation_reference: string }>>(
      `SELECT operation_reference FROM banking_outbound_operations
       WHERE external_operation_id=$1 LIMIT 2`,
      [externalOperationId],
    );
    if (rows.length > 1) {
      throw new ConflictException('The banking operation reference is ambiguous');
    }
    return rows[0]?.operation_reference ?? null;
  }

  private async initiateWithin(
    manager: EntityManager,
    plan: ParticipantPlan,
  ): Promise<{ commitment: FinancialCommitmentRecord; replayed: boolean }> {
    const input = plan;
    const destination =
      plan.kind === 'CUSTOMER'
        ? await this.resolveDestination(manager, plan.id, plan.beneficiaryId)
        : await this.resolveAgentDestination(manager, plan.id, plan.beneficiaryId);
    if (destination.targetReference !== input.target)
      throw new ConflictException(
        input.kind === 'CUSTOMER'
          ? 'Beneficiary changed after customer authorization'
          : 'Beneficiary changed after agent authorization',
      );
    let authorized;
    try {
      authorized = await this.authority.authorize(manager, {
        customerId: input.id,
        walletAccountId: input.walletId,
        beneficiaryId: input.beneficiaryId,
        beneficiaryVersion: destination.version,
        bankId: destination.bankId,
        bankCode: destination.bankCode,
        accountNumber: destination.accountNumber,
        targetReference: input.target,
        amountMinor: input.amountMinor,
        currency: input.currency,
        participantKind: input.kind,
      });
    } catch {
      throw new ServiceUnavailableException('Withdrawal execution authority is unavailable');
    }
    if (authorized.outcome === 'UNAVAILABLE')
      throw new ServiceUnavailableException('Withdrawal execution authority is unavailable');
    if (authorized.outcome !== 'AUTHORIZED')
      throw new ConflictException('Withdrawal execution is not authorized');
    if (!authorized.providerKey || !authorized.environment) {
      // An authority that claims AUTHORIZED without naming the provider it authorized cannot be
      // trusted to bind dispatch: the operation would be unresolvable at submission time.
      throw new ServiceUnavailableException('Withdrawal execution authority is unavailable');
    }
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.scopedKey]);
    const existing = await manager.query<FinancialCommitmentRecord[]>(
      'SELECT * FROM financial_commitments WHERE idempotency_key=$1 FOR UPDATE',
      [input.scopedKey],
    );
    if (existing[0]) {
      if (existing[0].request_hash !== input.requestHash)
        throw new ConflictException('Idempotency key was already used');
      return { commitment: existing[0], replayed: true };
    }
    if (input.kind === 'CUSTOMER') {
      await this.revalidateCustomerLane(manager, input);
    } else {
      await this.revalidateAgentLane(manager, input);
    }
    const wallets = await manager.query<
      Array<{ ledger_account_id: string; institution_id: string | null }>
    >(
      `SELECT ledger_account_id,institution_id FROM wallet_accounts WHERE id=$1 AND customer_id=$2
       AND status='ACTIVE' AND currency=$3 AND owner_class=$4 FOR UPDATE`,
      [input.walletId, input.id, input.currency, input.kind],
    );
    const wallet = wallets[0];
    if (!wallet)
      throw new ConflictException(
        input.kind === 'CUSTOMER'
          ? 'Customer wallet is not active'
          : 'Agent operating wallet is not active',
      );
    if (input.kind === 'CUSTOMER') {
      await this.walletBoundary.requireCustomerWallet(
        manager,
        input.id,
        input.walletId,
        wallet.ledger_account_id,
      );
      await this.limits.enforceWithManager(manager, {
        principalType: 'CUSTOMER',
        principalId: input.id,
        product: 'WITHDRAWAL',
        direction: 'OUTGOING',
        currency: input.currency,
        amountMinor: input.amountMinor,
        idempotencyKey: input.scopedKey,
        requestHash: input.requestHash,
        walletLedgerAccountId: wallet.ledger_account_id,
        principalWalletCustomerId: input.id,
        requireConfiguration: true,
        requireKycTierPolicy: true,
        institutionId: wallet.institution_id,
        serviceClass: null,
      });
    } else {
      await this.walletBoundary.requireAgentWallet(
        manager,
        input.id,
        input.walletId,
        wallet.ledger_account_id,
      );
      // Class-of-service limits for the declared product. Assignment-aware profiles are
      // conjunctive; nothing here invents an agent-specific limit.
      await this.limits.enforceWithManager(manager, {
        principalType: 'AGENT',
        principalId: input.id,
        agentClassId: input.agentClassId,
        product: 'EXTERNAL_BANK_TRANSFER',
        direction: 'OUTGOING',
        channel: null,
        currency: input.currency,
        amountMinor: input.amountMinor,
        idempotencyKey: input.scopedKey,
        requestHash: input.requestHash,
        walletLedgerAccountId: wallet.ledger_account_id,
        principalWalletCustomerId: input.id,
        requireConfiguration: true,
        strictConfiguredRules: true,
        institutionId: wallet.institution_id,
        serviceClass: null,
      });
    }
    const authorizationId = randomUUID();
    await this.commitments.insertAuthorization(manager, {
      id: authorizationId,
      customerId: input.kind === 'CUSTOMER' ? input.id : null,
      agentId: input.kind === 'AGENT' ? input.id : null,
      principalType: input.kind,
      sessionId: input.sessionId,
      pinAuditId: input.pinAuditId,
      walletAccountId: input.walletId,
      ledgerAccountId: wallet.ledger_account_id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      requestHash: input.requestHash,
      principalId: input.id,
      institution: wallet.institution_id,
    });
    const withdrawalId = await this.withdrawals.createWithdrawalInTransaction(manager, {
      walletId: input.walletId,
      ownership:
        input.kind === 'CUSTOMER'
          ? { kind: 'CUSTOMER_SELF', customerId: input.id }
          : { kind: 'AGENT_SELF', agentId: input.id },
      amountMinor: input.amountMinor,
      currency: input.currency,
      idempotencyKey: input.scopedKey,
    });
    const commitmentId = randomUUID();
    const context = { requestId: commitmentId, correlationId: commitmentId, traceId: commitmentId };
    const operation = await this.operations.createInTransaction(manager, {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      resourceType: ExternalOperationResourceType.WITHDRAWAL,
      resourceId: withdrawalId,
      internalCommandId: commitmentId,
      // The owner reference in both lanes — external_operations.customer_id is the shared
      // owner column, exactly as wallet_accounts.customer_id is.
      customerId: input.id,
      walletAccountId: input.walletId,
      ledgerAccountId: wallet.ledger_account_id,
      targetMappingReference: input.target,
      amountMinor: input.amountMinor,
      currency: input.currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyKey: input.scopedKey,
      requestContext: context,
      participantKind: input.kind,
    });
    const accounts = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-WITHDRAWAL_RESERVE-NGN' AND is_active=true`,
    );
    if (accounts.length !== 1)
      throw new ConflictException('Withdrawal reserve account is unavailable');
    const reserveId = accounts[0]!.id;
    const journalId = await this.ledger.postWithdrawalReservationInTransaction(
      manager,
      {
        idempotencyKey: input.scopedKey,
        currency: input.currency,
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: commitmentId,
        description: 'Authorized withdrawal reservation',
        correlationId: commitmentId,
        metadata: {
          commitmentId,
          withdrawalId,
          externalOperationId: operation.externalOperationId,
        },
        lines: [
          {
            accountId: wallet.ledger_account_id,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: input.amountMinor,
          },
          {
            accountId: reserveId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: input.amountMinor,
          },
        ],
      },
      authorizationId,
      operation.externalOperationId,
    );
    await this.commitments.insertReserved(manager, {
      id: commitmentId,
      authorizationId,
      withdrawalId,
      externalOperationId: operation.externalOperationId,
      reservationJournalId: journalId,
      reserveAccountId: reserveId,
      idempotencyKey: input.scopedKey,
      requestHash: input.requestHash,
    });
    await manager.query(
      `INSERT INTO financial_commitment_destinations
       (commitment_id,beneficiary_id,beneficiary_version,bank_id,bank_code,target_reference)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        commitmentId,
        input.beneficiaryId,
        destination.version,
        destination.bankId,
        destination.bankCode,
        input.target,
      ],
    );
    // Pricing is bound alongside the commitment, before dispatch is ever possible. The committed
    // amount is what the customer approved, so the bound pricing must agree with it exactly: if an
    // approved fee rule would charge a different total, this refuses rather than debiting an amount
    // the customer never authorized, and rather than silently absorbing the fee. No fee rule means no
    // fee binding, which is the current production state.
    const pricing = await this.fees.bindForCommittedOperationInTransaction(manager, {
      externalOperationId: operation.externalOperationId,
      institutionId: wallet.institution_id,
      walletId: input.walletId,
      currency: input.currency,
      committedAmountMinor: input.amountMinor,
    });
    if (pricing && pricing.customerDebitMinor !== input.amountMinor) {
      throw new ConflictException(
        'Committed amount does not match the authorized customer debit for this operation',
      );
    }

    // The durable dispatch intent is created HERE, inside the authorization transaction, so there is
    // no interval in which a commitment is authorized but has no dispatch record, and none in which a
    // dispatch record exists for a commitment that rolled back. An event-based bridge would open
    // exactly that window, which is where duplicate submission comes from.
    await this.bankingBridge.createDispatchIntentInTransaction(manager, {
      // Nullable by design: A6 also serves commitments whose provider is not a bank. The bridge
      // refuses to create a banking record without an institution, so a null here can only reach a
      // non-banking provider, which the bridge declines.
      institutionId: wallet.institution_id,
      providerKey: authorized.providerKey,
      environment: authorized.environment,
      externalOperationId: operation.externalOperationId,
      externalOperationReference: operation.externalOperationReference,
      walletId: input.walletId,
      currency: input.currency,
      amountMinor: input.amountMinor,
      destinationBankCode: destination.bankCode,
      destinationAccountNumber: destination.accountNumber,
      // The commitment binds the destination by reference, not by a stored display name. Passing null
      // is honest; copying a name from anywhere else would create a second source of truth for a
      // destination the customer already authorized.
      destinationAccountName: null,
    });
    const commitment = await this.commitments.lockByOperation(
      manager,
      operation.externalOperationId,
    );
    if (!commitment) throw new ConflictException('Financial commitment was not persisted');
    // Governed notification: external_bank_transfer.pending — only for new commitments, never on replay
    if (this.outboxService) {
      try {
        const amountMinor = input.amountMinor;
        const refShort = commitmentId.slice(0, 8);
        await this.outboxService.enqueue(manager, {
          eventType: 'external_bank_transfer.pending',
          aggregateType: 'FINANCIAL_COMMITMENT',
          aggregateId: commitmentId,
          payload: {
            commitmentId,
            externalOperationId: operation.externalOperationId,
            principalType: input.kind,
            customerId: input.kind === 'CUSTOMER' ? input.id : null,
            agentId: input.kind === 'AGENT' ? input.id : null,
            amountMinor,
            currency: input.currency,
            reference: refShort,
          },
          eventKey: `external_bank_transfer.pending:${commitmentId}:v1`,
          schemaVersion: 1,
          classification: 'CONFIDENTIAL',
          retentionClass: 'FINANCIAL_CONTROL',
          correlationId: commitmentId,
          causationId: commitmentId,
        });
      } catch {
        /* outbox is best-effort; financial commitment remains authoritative */
      }
    }
    return { commitment, replayed: false };
  }

  /** Resolve from locked customer-owned records. A beneficiary verification flag is
   * not proof of provider account ownership, and never enables production submission. */
  private async resolveDestination(
    manager: EntityManager,
    customerId: string,
    beneficiaryId: string,
  ): Promise<{
    version: number;
    bankId: string;
    bankCode: string;
    accountNumber: string;
    targetReference: string;
  }> {
    const rows = await manager.query<
      Array<{
        id: string;
        customer_id: string;
        version: number;
        destination_identifier: string;
        bank_id: string;
        bank_code: string;
      }>
    >(
      `SELECT b.id,b.customer_id,b.version,b.destination_identifier,k.id AS bank_id,k.bank_code
       FROM customer_beneficiaries b
       JOIN beneficiary_ownerships bo ON bo.beneficiary_id=b.id AND bo.customer_id=b.customer_id AND bo.deleted_at IS NULL
       JOIN banks k ON k.bank_code=b.destination_institution
       WHERE b.id=$1 AND b.customer_id=$2 AND b.beneficiary_type='BANK_ACCOUNT'
         AND b.status='ACTIVE' AND b.verified AND b.deleted_at IS NULL
         AND b.destination_identifier ~ '^[0-9]{4,32}$' AND k.status='ACTIVE' AND k.nip_supported
       FOR SHARE OF b,bo,k`,
      [beneficiaryId, customerId],
    );
    const row = rows[0];
    if (rows.length !== 1 || !row)
      throw new ConflictException('Customer bank beneficiary is not available');
    const targetReference = `a6-target:${this.hash(`v1|${row.id}|${row.customer_id}|${row.version}|${row.bank_code}|${row.destination_identifier}`)}`;
    return {
      version: row.version,
      bankId: row.bank_id,
      bankCode: row.bank_code,
      accountNumber: row.destination_identifier,
      targetReference,
    };
  }

  /** Customer lane revalidation inside the commitment transaction. */
  private async revalidateCustomerLane(
    manager: EntityManager,
    plan: ParticipantPlan,
  ): Promise<void> {
    const sessions = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM authentication_sessions WHERE id=$1 AND customer_id=$2 AND status='ACTIVE'
       AND audience='customer-api' AND expires_at>clock_timestamp() FOR SHARE`,
      [plan.sessionId, plan.id],
    );
    if (sessions.length !== 1)
      throw new UnauthorizedException('Customer session is no longer active');
    const credential = await manager.query<Array<{ id: string }>>(
      `SELECT c.id FROM customer_authentication_credentials c
       JOIN authentication_sessions s ON s.credential_id=c.id AND s.customer_id=c.customer_id
       WHERE s.id=$1 AND c.deleted_at IS NULL AND c.status='ACTIVE' AND NOT c.account_locked
         AND NOT c.rotation_required AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp())
         AND (s.onboarding_password_version IS NULL OR s.onboarding_password_version=c.password_version)
       FOR SHARE OF c`,
      [plan.sessionId],
    );
    if (credential.length !== 1)
      throw new UnauthorizedException('Customer credential is no longer active');
    const pin = await manager.query<Array<{ id: string }>>(
      `SELECT p.id FROM customer_transaction_pins p JOIN audit_events a ON a.entity_id=p.id
       WHERE p.customer_id=$1 AND p.deleted_at IS NULL AND NOT p.account_locked
         AND a.id=$2 AND a.entity_type='CUSTOMER_TRANSACTION_PIN' AND a.action='PIN_VERIFIED'
         AND a.new_values->>'financialRequestHash'=$3 AND a.new_values->>'sessionId'=$4
         AND a.new_values->>'pinVersion'=p.pin_version::text AND p.last_changed_at<=a.occurred_at
       FOR SHARE OF p`,
      [plan.id, plan.pinAuditId, plan.requestHash, plan.sessionId],
    );
    if (pin.length !== 1)
      throw new UnauthorizedException('Customer PIN authorization is no longer active');
  }

  /**
   * Agent lane revalidation inside the commitment transaction. Mirrors the customer lane with the
   * agent authority chain: the agent is ACTIVE and undeleted, the agent-api session is ACTIVE,
   * unexpired, unrevoked and bound to an ACTIVE agent credential with no lock, no rotation pending
   * and a live password, and the bound agent PIN verification still matches this request.
   */
  private async revalidateAgentLane(manager: EntityManager, plan: ParticipantPlan): Promise<void> {
    const agents = await manager.query<Array<{ id: string }>>(
      "SELECT id FROM agents WHERE id=$1 AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE",
      [plan.id],
    );
    if (agents.length !== 1) throw new ForbiddenException('Agent is not permitted');
    const rows = await manager.query<Array<{ eligible: boolean }>>(
      `SELECT (s.status='ACTIVE' AND s.revoked_at IS NULL AND s.audience='agent-api' AND s.expires_at>clock_timestamp()
               AND c.status='ACTIVE' AND c.deleted_at IS NULL AND c.rotation_required=FALSE AND c.account_locked=FALSE
               AND (c.password_expires_at IS NULL OR c.password_expires_at>clock_timestamp())
               AND s.issued_at>=c.password_changed_at) AS eligible
       FROM agent_authentication_sessions s
       JOIN agent_authentication_credentials c ON c.id=s.credential_id AND c.agent_id=s.agent_id
       WHERE s.id=$1 AND s.agent_id=$2 FOR SHARE OF c,s`,
      [plan.sessionId, plan.id],
    );
    if (rows[0]?.eligible !== true)
      throw new UnauthorizedException('Agent session is no longer active');
    const pin = await manager.query<Array<{ id: string }>>(
      `SELECT p.id FROM agent_transaction_pins p JOIN audit_events a ON a.entity_id=p.id
       WHERE p.agent_id=$1 AND p.deleted_at IS NULL AND NOT p.account_locked
         AND a.id=$2 AND a.entity_type='AGENT_TRANSACTION_PIN' AND a.action='PIN_VERIFIED'
         AND a.new_values->>'financialRequestHash'=$3 AND a.new_values->>'sessionId'=$4
         AND a.new_values->>'pinVersion'=p.pin_version::text AND p.last_changed_at<=a.occurred_at
       FOR SHARE OF p`,
      [plan.id, plan.pinAuditId, plan.requestHash, plan.sessionId],
    );
    if (pin.length !== 1)
      throw new UnauthorizedException('Agent PIN authorization is no longer active');
  }

  /** Resolve from locked agent-owned records. Same discipline as the customer lane. */
  private async resolveAgentDestination(
    manager: EntityManager,
    agentId: string,
    beneficiaryId: string,
  ): Promise<{
    version: number;
    bankId: string;
    bankCode: string;
    accountNumber: string;
    targetReference: string;
  }> {
    // Mirrors resolveDestination exactly, with agent ownership: agent-owned BANK_ACCOUNT beneficiary,
    // ACTIVE agent affiliation binding, destination format and a NIP-capable ACTIVE bank. Reuses the
    // same immutable a6-target reference function so dispatch and settlement binding are shared.
    const rows = await manager.query<
      Array<{
        id: string;
        agent_id: string;
        version: number;
        destination_identifier: string;
        bank_id: string;
        bank_code: string;
      }>
    >(
      `SELECT b.id,b.agent_id,b.version,b.destination_identifier,k.id AS bank_id,k.bank_code
       FROM customer_beneficiaries b
       JOIN beneficiary_ownerships bo ON bo.beneficiary_id=b.id AND bo.agent_id=b.agent_id AND bo.deleted_at IS NULL
       JOIN banks k ON k.bank_code=b.destination_institution
       WHERE b.id=$1 AND b.agent_id=$2 AND b.beneficiary_type='BANK_ACCOUNT'
         AND b.status='ACTIVE' AND b.verified AND b.deleted_at IS NULL
         AND b.destination_identifier ~ '^[0-9]{4,32}$' AND k.status='ACTIVE' AND k.nip_supported
       FOR SHARE OF b,bo,k`,
      [beneficiaryId, agentId],
    );
    const row = rows[0];
    if (rows.length !== 1 || !row)
      throw new ConflictException('Agent bank beneficiary is not available');
    const targetReference = `a6-target:${this.hash(`v1|${row.id}|${row.agent_id}|${row.version}|${row.bank_code}|${row.destination_identifier}`)}`;
    return {
      version: row.version,
      bankId: row.bank_id,
      bankCode: row.bank_code,
      accountNumber: row.destination_identifier,
      targetReference,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
