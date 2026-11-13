import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
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
  /** Correlation with a target resolved by the caller's trusted target boundary, not authorization. */
  targetMappingReference: string;
  idempotencyKey: string;
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
  ) {}

  async initiate(
    input: InitiateFinancialCommitment,
  ): Promise<{ commitment: FinancialCommitmentRecord; replayed: boolean }> {
    const session = await this.sessions.validate({ token: input.token, audience: 'customer-api' });
    if (!session.valid || !session.principal)
      throw new UnauthorizedException('Customer session is invalid');
    const principal = session.principal;
    const walletId = input.walletAccountId.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(walletId))
      throw new BadRequestException('walletAccountId must be a UUID');
    const amountMinor = parsePositiveMinorUnits(input.amountMinor).toString();
    const currency = normalizeCurrency(input.currency);
    if (currency !== 'NGN') throw new BadRequestException('Only NGN withdrawals are supported');
    const target = input.targetMappingReference.trim();
    if (!/^a6-target:[a-f0-9]{64}$/.test(target))
      throw new BadRequestException('Target reference is invalid');
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.initiateWithin(manager, {
            customerId: principal.customerId,
            sessionId: principal.sessionId,
            auditId: pin.auditId!,
            walletId,
            amountMinor,
            currency,
            target,
            scopedKey,
            requestHash,
          }),
        );
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Commitment transaction could not complete');
  }

  private async initiateWithin(
    manager: EntityManager,
    input: {
      customerId: string;
      sessionId: string;
      auditId: string;
      walletId: string;
      amountMinor: string;
      currency: string;
      target: string;
      scopedKey: string;
      requestHash: string;
    },
  ): Promise<{ commitment: FinancialCommitmentRecord; replayed: boolean }> {
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
    const sessions = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM authentication_sessions WHERE id=$1 AND customer_id=$2 AND status='ACTIVE'
       AND audience='customer-api' AND expires_at>clock_timestamp() FOR SHARE`,
      [input.sessionId, input.customerId],
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
      [input.sessionId],
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
      [input.customerId, input.auditId, input.requestHash, input.sessionId],
    );
    if (pin.length !== 1)
      throw new UnauthorizedException('Customer PIN authorization is no longer active');
    const wallets = await manager.query<Array<{ ledger_account_id: string }>>(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1 AND customer_id=$2
       AND status='ACTIVE' AND currency=$3 FOR UPDATE`,
      [input.walletId, input.customerId, input.currency],
    );
    const wallet = wallets[0];
    if (!wallet) throw new ConflictException('Customer wallet is not active');
    await this.walletBoundary.requireCustomerWallet(
      manager,
      input.customerId,
      input.walletId,
      wallet.ledger_account_id,
    );
    await this.limits.enforceWithManager(manager, {
      principalType: 'CUSTOMER',
      principalId: input.customerId,
      product: 'WITHDRAWAL',
      direction: 'OUTGOING',
      currency: input.currency,
      amountMinor: input.amountMinor,
      idempotencyKey: input.scopedKey,
      requestHash: input.requestHash,
      walletLedgerAccountId: wallet.ledger_account_id,
      principalWalletCustomerId: input.customerId,
    });
    const authorizationId = randomUUID();
    await this.commitments.insertAuthorization(manager, {
      id: authorizationId,
      customerId: input.customerId,
      sessionId: input.sessionId,
      pinAuditId: input.auditId,
      walletAccountId: input.walletId,
      ledgerAccountId: wallet.ledger_account_id,
      amountMinor: input.amountMinor,
      currency: input.currency,
      requestHash: input.requestHash,
      principalId: input.customerId,
      institution: 'MONIENAIJA',
    });
    const withdrawalId = await this.withdrawals.createWithdrawalInTransaction(manager, {
      walletId: input.walletId,
      ownership: { kind: 'CUSTOMER_SELF', customerId: input.customerId },
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
      customerId: input.customerId,
      walletAccountId: input.walletId,
      ledgerAccountId: wallet.ledger_account_id,
      targetMappingReference: input.target,
      amountMinor: input.amountMinor,
      currency: input.currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyKey: input.scopedKey,
      requestContext: context,
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
    const commitment = await this.commitments.lockByOperation(
      manager,
      operation.externalOperationId,
    );
    if (!commitment) throw new ConflictException('Financial commitment was not persisted');
    return { commitment, replayed: false };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
