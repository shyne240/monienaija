/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars */
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, pbkdf2Sync, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';
import { AGENT_DESK_OTP_PURPOSE_CASH_TO_CASH_CLAIM } from './agent-desk-otp.constants';

import { LimitEnforcementService } from '../limit-catalog/limit-enforcement.service';
import type { EnforceResult } from '../limit-catalog/limit-enforcement.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { CommercialDecisionSnapshotService } from '../commercial-decision/commercial-decision-snapshot.service';
import {
  commissionNone,
  feeNotConfigured,
  limitApproved,
  limitNotEvaluated,
  rewardNone,
} from '../commercial-decision/commercial-decision.defaults';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletService } from '../wallet/wallet.service';
import { WalletStatus } from '../wallet/wallet.enums';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { isRetryableTransactionError, MAX_SERIALIZABLE_ATTEMPTS } from '../common/serializable-transaction';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentService, normalizeAgentService } from './agent-service.enum';
import { MfaExecutionService } from '../customer-authentication/mfa-execution.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type {
  AgentCashToCashClaimInput,
  AgentCashToCashClaimResult,
  AgentCashToCashRedemptionMethod,
} from './agent-cash-to-cash-claim.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETENTION_SECONDS = 86400;
const UNCLAIMED_CODE = 'CASH_TO_CASH-UNCLAIMED-NGN';
const MAX_FAILED_ATTEMPTS = 5;
const CLAIM_IDEMPOTENCY_PREFIX = 'cash-to-cash-claim.v1:';

interface ClaimRequestFingerprintInput {
  transferId: string;
  beneficiaryPhone: string;
  claimantCustomerId: string;
  claimantAgentId: string | null;
  redemptionMethod: AgentCashToCashRedemptionMethod;
  principalMinor: string;
  currency: string;
  unclaimedAccountId: string;
  settlementWalletLedgerId: string;
  reference: string;
  correlationId: string | null;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AgentCashToCashClaimService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly walletService: WalletService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly agentAuthorizationService: AgentTransactionAuthorizationService,
    private readonly mfaExecutionService: MfaExecutionService,
    @Optional()
    private readonly limitEnforcementService?: LimitEnforcementService,
    // V1-COMMERCIAL-DECISION-03C — CASH_TO_CASH CLAIM commercial snapshot wiring.
    // Both optional: absent → no snapshot (unit tests constructing directly keep working).
    @Optional()
    private readonly feeRuleResolverService?: FeeRuleResolverService,
    @Optional()
    private readonly commercialDecisionSnapshotService?: CommercialDecisionSnapshotService,
    // V1-COMMERCIAL-IMPLEMENTATION-01 — single fee computation authority (optional; absent →
    // legacy evidence shape for manual-construction unit tests).
    @Optional()
    private readonly feeRuleCalculatorService?: FeeRuleCalculatorService,
  ) {}

  /** Authenticated command, never a public UUID lookup. All transfer-specific failures
   * share one envelope; the canonical service alone verifies credentials and posts funds. */
  async executeByLocator(
    input: Omit<AgentCashToCashClaimInput, 'transferId'> & { senderPhone: string; transferNumber: string },
  ): Promise<AgentCashToCashClaimResult> {
    const started = Date.now();
    try {
      const principal = input.claimantPrincipal;
      const id = await this.resolveProtectedLocator(input.senderPhone, input.transferNumber, principal);
      if (!id) throw this.locatorUnavailable();
      const { senderPhone: _phone, transferNumber: _number, ...claim } = input;
      try {
        return await this.execute({ ...claim, transferId: id });
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw this.locatorUnavailable();
        throw new ServiceUnavailableException({ code: 'C2C_RETRY_REQUIRED', message: 'Claim outcome unavailable; recover before retrying' });
      }
    } finally {
      // Equalize cheap unknown-locator and invalid-code failures below a common floor.
      // Rate budgets remain authoritative; this is not a constant-time network guarantee.
      await delay(Math.max(0, 100 - (Date.now() - started)));
    }
  }

  async recoverByLocator(
    senderPhone: string, transferNumber: string, idempotencyKey: string, principal: AuthorizationPrincipal,
  ): Promise<AgentCashToCashClaimResult> {
    const id = await this.resolveProtectedLocator(senderPhone, transferNumber, principal);
    if (!id) throw this.locatorUnavailable();
    try {
      const result = await this.recoverClaimForAgent(id, principal);
      if (result.idempotencyKey !== idempotencyKey) throw this.locatorUnavailable();
      return result;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) throw this.locatorUnavailable();
      throw new ServiceUnavailableException({ code: 'C2C_RETRY_REQUIRED', message: 'Claim outcome unavailable; recover before retrying' });
    }
  }

  private locatorUnavailable(): NotFoundException {
    return new NotFoundException({ code: 'C2C_CLAIM_NOT_AVAILABLE', message: 'Claim not available' });
  }

  private async resolveProtectedLocator(
    phone: string, number: string, principal?: AuthorizationPrincipal,
  ): Promise<string | undefined> {
    if (!principal || principal.type !== 'AGENT' || !principal.agentId ||
        principal.agentId.toLowerCase() !== principal.principalId.toLowerCase()) {
      throw new UnauthorizedException('Agent authentication required');
    }
    await this.dataSource.transaction((manager) => this.assertAgentSessionWithManager(manager, principal));
    // Charge the Agent before parsing or querying a locator. Unknown and known locators
    // consume identical persistent budgets. Hash keys to avoid raw phone storage here.
    await this.chargeLocatorBudget(`agent:${principal.agentId.toLowerCase()}`, 20);
    const canonicalPhone = typeof phone === 'string' ? AgentReceivingNumberService.canonicalizeTo10(phone.trim()) : null;
    if (!canonicalPhone || typeof number !== 'string' || !/^[0-9]{6}$/.test(number)) throw this.locatorUnavailable();
    await this.chargeLocatorBudget(`sender:${canonicalPhone}`, 100);
    await this.chargeLocatorBudget(`pair:${canonicalPhone}:${number}`, 10);
    const rows: Array<{ transfer_id: string }> = await this.dataSource.query(
      `SELECT transfer_id FROM cash_to_cash_locators WHERE sender_phone=$1 AND transfer_number=$2`,
      [canonicalPhone, number],
    );
    return rows[0]?.transfer_id;
  }

  private async chargeLocatorBudget(key: string, maximum: number): Promise<void> {
    const rows: Array<{ attempts: number }> = await this.dataSource.query(
      `INSERT INTO cash_to_cash_locator_attempts(bucket_key, window_start, attempts)
       VALUES ($1,clock_timestamp(),1)
       ON CONFLICT (bucket_key) DO UPDATE SET
         attempts=CASE WHEN cash_to_cash_locator_attempts.window_start <= clock_timestamp()-INTERVAL '60 seconds'
                       THEN 1 ELSE LEAST(cash_to_cash_locator_attempts.attempts+1, 1000000) END,
         window_start=CASE WHEN cash_to_cash_locator_attempts.window_start <= clock_timestamp()-INTERVAL '60 seconds'
                           THEN clock_timestamp() ELSE cash_to_cash_locator_attempts.window_start END
       RETURNING attempts`,
      [createHash('sha256').update(key).digest('hex')],
    );
    if (!rows[0] || rows[0].attempts > maximum) {
      throw new HttpException({ code: 'C2C_LOCATOR_RATE_LIMITED', message: 'Too many locator requests; retry later' }, 429);
    }
  }

  async execute(input: AgentCashToCashClaimInput): Promise<AgentCashToCashClaimResult> {
    const transferId = input.transferId?.trim().toLowerCase();
    if (!transferId || !UUID_PATTERN.test(transferId)) {
      throw new BadRequestException('transferId must be a UUID');
    }
    const rawPhone = input.beneficiaryPhone?.trim();
    if (!rawPhone) throw new BadRequestException('beneficiaryPhone is required');
    const canonicalPhone = AgentReceivingNumberService.canonicalizeTo10(rawPhone);
    if (!canonicalPhone) throw new BadRequestException('beneficiaryPhone must be a valid Nigerian 10-digit number');

    const transferCode = input.transferCode?.trim();
    if (!transferCode || !/^\d+$/.test(transferCode)) throw new BadRequestException('transferCode is required');
    if (transferCode.length > 20) throw new BadRequestException('transferCode too long');

    const customerId = input.customerId?.trim().toLowerCase();
    if (!customerId || !UUID_PATTERN.test(customerId)) throw new BadRequestException('customerId must be a UUID');

    const mfaChallengeId = input.mfaChallengeId?.trim().toLowerCase();
    if (!mfaChallengeId || !UUID_PATTERN.test(mfaChallengeId)) throw new BadRequestException('mfaChallengeId must be a UUID');
    const otp = input.otp?.trim();
    if (!otp || otp.length > 512 || /\s/.test(otp)) throw new BadRequestException('otp is invalid');

    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new BadRequestException('idempotencyKey is required and must be at most 255 characters');

    const redemptionMethod: AgentCashToCashRedemptionMethod = input.redemptionMethod ?? 'CUSTOMER_WALLET';
    if (redemptionMethod !== 'CUSTOMER_WALLET' && redemptionMethod !== 'AGENT_CASH') {
      throw new BadRequestException('redemptionMethod must be CUSTOMER_WALLET or AGENT_CASH');
    }

    // The public HTTP route is an Agent-desk operation. Bind the settlement and audit trail
    // to the authenticated Agent, and reject a principal whose session identity is inconsistent.
    // `claimantPrincipal` remains optional for direct service-level wallet tests/internal callers;
    // the controller independently requires an authenticated Agent before invoking this service.
    let claimantAgentId: string | null = null;
    let claimantActor = customerId;
    if (input.claimantPrincipal) {
      const principal = input.claimantPrincipal;
      if (
        principal.type !== 'AGENT' ||
        !principal.agentId ||
        !UUID_PATTERN.test(principal.agentId) ||
        principal.agentId.toLowerCase() !== principal.principalId.toLowerCase()
      ) {
        throw new ForbiddenException('An authenticated Agent is required to process this claim');
      }
      claimantAgentId = principal.agentId.toLowerCase();
      claimantActor = principal.principalId.toLowerCase();
    }

    let authorizedPin: { id: string; pin_hash: string; hash_algorithm: string; pin_version: number; last_changed_at: string } | undefined;
    if (redemptionMethod === 'AGENT_CASH') {
      if (!claimantAgentId || !input.claimantPrincipal) {
        throw new ForbiddenException('An authenticated Agent is required for cash redemption');
      }
      if (typeof input.agentPin !== 'string' || !input.agentPin.trim()) {
        throw new BadRequestException('agentPin is required for Agent cash redemption');
      }
      // Capture before authorization; an intervening rotation must not grant a stale proof.
      [authorizedPin] = await this.dataSource.query(
        `SELECT id, pin_hash, hash_algorithm, pin_version, last_changed_at::text AS last_changed_at FROM agent_transaction_pins
         WHERE agent_id=$1 AND deleted_at IS NULL`, [claimantAgentId],
      );
      await this.assertAgentCashRedemptionAuthorization(
        claimantAgentId,
        input.agentPin,
        input.claimantPrincipal,
      );
    } else if (input.agentPin && input.agentPin.trim()) {
      throw new BadRequestException('agentPin is accepted only for Agent cash redemption');
    }
    if (input.claimantPrincipal) {
      await this.dataSource.transaction((manager) => this.assertAgentSessionWithManager(manager, input.claimantPrincipal!));
    }
    const settlementWalletOwnerId = redemptionMethod === 'AGENT_CASH' ? claimantAgentId! : customerId;

    const reference = input.reference?.trim() ? input.reference.trim() : `CASH_TO_CASH_CLAIM-${idempotencyKey}`;
    const description = input.description?.trim()
      ? input.description.trim()
      : redemptionMethod === 'AGENT_CASH'
        ? `Cash→Cash cash redemption ${transferId} at Agent ${claimantAgentId}`
        : `Cash→Cash wallet redemption ${transferId} to Customer ${customerId}`;
    // Report 26 (N-02): bounded, deterministic sanitization of the caller-supplied
    // business correlation id (legitimate ids preserved byte-for-byte).
    const correlationId = sanitizeDiagnosticIdentifier(input.correlationId);

    const unclaimedAccount = await this.getUnclaimedAccount();
    if (!unclaimedAccount) throw new BadRequestException('Unclaimed ledger account not provisioned');

    // Pre-checks outside SERIALIZABLE to avoid wasting OTP and to handle code lockout persistence cleanly.
    // 1. Fetch transfer (without lock) for phone/code/identity pre-checks.
    const preTransferRows: Array<{
      id: string;
      beneficiary_phone: string;
      principal_minor: string;
      currency: string;
      status: string;
      transfer_code_hash: string;
      failed_attempts: number;
      is_locked: boolean;
      is_expired: boolean;
    }> = await this.dataSource.query(`SELECT id, beneficiary_phone, principal_minor, currency, status, transfer_code_hash, failed_attempts, is_locked, expires_at <= clock_timestamp() AS is_expired FROM cash_to_cash_transfers WHERE id=$1 LIMIT 1`, [transferId]);
    const preTransfer = preTransferRows[0];
    if (!preTransfer) throw new NotFoundException(`Cash→Cash transfer ${transferId} not found`);
    if (preTransfer.status === 'EXPIRED' || (preTransfer.status === 'UNCLAIMED' && preTransfer.is_expired)) {
      throw new ConflictException('Transfer has expired and cannot be claimed');
    }
    if (preTransfer.status === 'CLAIMED') {
      // For already claimed, we still need to handle idempotency properly inside transaction (replay vs conflict).
      // We will let the transaction handle it, but we can early return if this is a replay with same key? We'll just continue to OTP+transaction.
    } else {
      if (preTransfer.status !== 'UNCLAIMED') throw new ConflictException(`Transfer status ${preTransfer.status} cannot be claimed`);
      if (preTransfer.is_locked) throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
      if (preTransfer.beneficiary_phone !== canonicalPhone) throw new BadRequestException('Beneficiary phone does not match transfer');
      // V1-SYSTEM-01: the caller-supplied `beneficiaryPhone` string matching the transfer's
      // stored value only proves the caller *typed* the right number — it does not prove the
      // claiming `customerId` actually *owns* that phone. Without this check, any customer who
      // learns a victim's phone number plus the transfer code could claim the funds into their
      // OWN wallet by presenting their own valid OTP (which agent-desk-otp always issues to the
      // `customerId`'s own verified phone, never to an arbitrary target phone). Fail closed.
      await this.assertClaimantOwnsBeneficiaryPhone(this.dataSource, customerId, canonicalPhone);
      // A document row records submission, not review or verification. Wallet redemption therefore
      // fails closed unless the Customer's authoritative KYC status is APPROVED. Cash payout uses
      // the current assessment gate below. Both checks run before OTP consumption.
      if (redemptionMethod === 'AGENT_CASH') {
        await this.assertCurrentApprovedKyc(this.dataSource, customerId);
      } else {
        const custRows: Array<{ id: string; status: string; kyc_status: string; deleted_at: string | null }> = await this.dataSource.query(
          `SELECT id, status, kyc_status, deleted_at FROM customers WHERE id=$1 LIMIT 1`,
          [customerId],
        );
        const customer = custRows[0];
        if (!customer || customer.deleted_at !== null) throw new NotFoundException(`Customer ${customerId} not found`);
        if (customer.status !== 'ACTIVE') throw new NotFoundException(`Customer ${customerId} not found`);
        if (customer.kyc_status !== 'APPROVED') {
          throw new ForbiddenException('Claimant identity not verified (KYC not APPROVED)');
        }
        await this.assertWalletAssessmentUnexpired(this.dataSource, customerId);
      }
      // Transfer code verification before OTP (timing-safe, not consuming OTP if code wrong)
      const codeValidPre = this.verifyTransferCode(transferCode, preTransfer.transfer_code_hash);
      if (!codeValidPre) {
        const locked = await this.recordFailedCode(transferId, preTransfer.transfer_code_hash);
        if (locked) throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
        throw new UnauthorizedException('Transfer code invalid');
      }
    }

    // 2. OTP verification via canonical MfaExecutionService (outside SERIALIZABLE, before financial)
    // Fetch challenge meta to build principal
    const challengeMetaPre: Array<{ customer_id: string; session_id: string }> = await this.dataSource.query(
      `SELECT customer_id, session_id FROM mfa_challenges WHERE id=$1 LIMIT 1`,
      [mfaChallengeId],
    );
    const metaPre = challengeMetaPre[0];
    if (!metaPre) throw new BadRequestException('Invalid OTP challenge');
    if (metaPre.customer_id !== customerId) throw new BadRequestException('OTP challenge does not belong to this Customer');
    const sessionRowsPre: Array<{ credential_id: string }> = await this.dataSource.query(
      `SELECT credential_id FROM authentication_sessions WHERE id=$1 LIMIT 1`,
      [metaPre.session_id],
    );
    let credentialIdPre = sessionRowsPre[0]?.credential_id;
    if (!credentialIdPre) {
      const credRows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 AND status='ACTIVE' AND deleted_at IS NULL LIMIT 1`,
        [customerId],
      );
      credentialIdPre = credRows[0]?.id ?? '';
      if (!credentialIdPre || !UUID_PATTERN.test(credentialIdPre)) throw new BadRequestException('OTP verification unavailable - no credential');
    }
    const principalForMfaPre: any = {
      principalType: 'CUSTOMER',
      customerId,
      sessionId: metaPre.session_id,
      credentialId: credentialIdPre,
    };
    const verifyResultPre = await this.mfaExecutionService.verifyChallenge({
      principal: principalForMfaPre,
      challengeId: mfaChallengeId,
      providedHash: otp,
      actor: customerId,
      expectedPurpose: AGENT_DESK_OTP_PURPOSE_CASH_TO_CASH_CLAIM,
    } as any);
    if (!verifyResultPre.verified) {
      const reason = verifyResultPre.failureReason;
      if (reason === 'REPLAYED') {
        // Check if this is an idempotent replay (same transferId + same idempotencyKey already completed)
        const existingIdem: Array<{ status: string; response_body: any; request_hash: string }> = await this.dataSource.query(
          `SELECT status, response_body, request_hash FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2 LIMIT 1`,
          [`${CLAIM_IDEMPOTENCY_PREFIX}${transferId}`, idempotencyKey],
        );
        if (existingIdem[0] && (existingIdem[0].status === 'COMPLETED' || existingIdem[0].status === 'IN_PROGRESS')) {
          // A consumed OTP may only recover the exact completed destination, request, and Agent.
          const claimed: Array<{
            claim_journal_id: string | null;
            claimant_customer_id: string;
            beneficiary_phone: string;
            principal_minor: string;
            currency: string;
          }> = await this.dataSource.query(
            `SELECT claim_journal_id, claimant_customer_id, beneficiary_phone, principal_minor, currency
             FROM cash_to_cash_transfers WHERE id=$1`,
            [transferId],
          );
          const claimedTransfer = claimed[0];
          if (claimedTransfer?.claim_journal_id) {
            const actorRows: Array<{ actor: string }> = await this.dataSource.query(
              `SELECT actor FROM audit_events
               WHERE entity_type='AGENT_CASH_TO_CASH_CLAIM' AND action='CASH_TO_CASH_CLAIMED' AND entity_id=$1
               LIMIT 1`,
              [claimedTransfer.claim_journal_id],
            );
            if (!actorRows[0]?.actor || actorRows[0].actor.toLowerCase() !== claimantActor.toLowerCase()) {
              throw new ConflictException('Idempotency key belongs to a different claimant Agent');
            }
            const body = existingIdem[0].response_body as unknown as AgentCashToCashClaimResult | null;
            const recordedMethod = body?.redemptionMethod ?? 'CUSTOMER_WALLET';
            if (recordedMethod !== redemptionMethod) {
              throw new ConflictException('Idempotency key already used with a different redemption method');
            }
            const settlementWallet = await this.dataSource.getRepository(WalletAccount).findOne({
              where: { customerId: settlementWalletOwnerId, currency: 'NGN' },
            });
            if (!settlementWallet) throw new ConflictException('Prior claim destination cannot be verified for replay');
            const fingerprintInput: ClaimRequestFingerprintInput = {
              transferId,
              beneficiaryPhone: canonicalPhone,
              claimantCustomerId: customerId,
              claimantAgentId,
              redemptionMethod,
              principalMinor: claimedTransfer.principal_minor,
              currency: claimedTransfer.currency,
              unclaimedAccountId: unclaimedAccount.id,
              settlementWalletLedgerId: settlementWallet.ledgerAccountId,
              reference,
              correlationId: correlationId ?? null,
              metadata: input.metadata ?? {},
            };
            const expectedHash = this.computeClaimRequestHash(fingerprintInput);
            const legacyWalletHash = redemptionMethod === 'CUSTOMER_WALLET'
              ? this.computeLegacyWalletClaimRequestHash(fingerprintInput)
              : null;
            if (
              existingIdem[0].request_hash !== expectedHash &&
              existingIdem[0].request_hash !== legacyWalletHash
            ) {
              throw new ConflictException('Idempotency key already used with different financial parameters');
            }
            if (body && body.journalId) {
              return { ...body, redemptionMethod, status: 'REPLAYED' as const, replayed: true };
            }
            return {
              status: 'REPLAYED',
              transferId,
              journalId: claimedTransfer.claim_journal_id,
              beneficiaryPhone: claimedTransfer.beneficiary_phone,
              principalMinor: claimedTransfer.principal_minor,
              currency: claimedTransfer.currency,
              amountMinor: claimedTransfer.principal_minor,
              claimantCustomerId: claimedTransfer.claimant_customer_id,
              redemptionMethod,
              idempotencyKey,
              requestHash: existingIdem[0].request_hash,
              replayed: true,
              correlationId,
              reference,
              claimedAt: new Date(),
            };
          }
        }
        throw new BadRequestException('OTP already used');
      }
      if (reason === 'EXPIRED') throw new BadRequestException('OTP expired');
      if (reason === 'MISMATCH') throw new BadRequestException('OTP invalid');
      throw new BadRequestException(`OTP invalid: ${reason}`);
    }

    // Prepare the server-selected destination wallet before SERIALIZABLE. For cash redemption this
    // is Agent B's float; for wallet redemption it is the verified beneficiary Customer's wallet.
    await this.ensureWalletAccountExists(settlementWalletOwnerId);

    const scope = `${CLAIM_IDEMPOTENCY_PREFIX}${transferId}`;

    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          // Lock transfer row
          const transfers: Array<{
            id: string;
            beneficiary_phone: string;
            principal_minor: string;
            fee_minor: string;
            vat_minor: string;
            total_minor: string;
            currency: string;
            status: string;
            transfer_code_hash: string;
            hash_algorithm: string;
            failed_attempts: number;
            is_locked: boolean;
            locked_at: string | null;
            journal_id: string;
            claimant_customer_id: string | null;
            claim_journal_id: string | null;
            claim_idempotency_key: string | null;
          }> = await manager.query(
            `SELECT * FROM cash_to_cash_transfers WHERE id = $1 FOR UPDATE`,
            [transferId],
          );
          const transfer = transfers[0];
          if (!transfer) throw new NotFoundException(`Cash→Cash transfer ${transferId} not found`);

          // Lock current authentication evidence until commit, including receipt replay.
          if (input.claimantPrincipal) {
            await this.assertAgentSessionWithManager(manager, input.claimantPrincipal);
          }
          if (redemptionMethod === 'AGENT_CASH') {
            const pins = await manager.query(
              `SELECT id, pin_hash, hash_algorithm, pin_version, last_changed_at::text AS last_changed_at, account_locked
               FROM agent_transaction_pins WHERE agent_id=$1 AND deleted_at IS NULL FOR SHARE`,
              [claimantAgentId],
            );
            const pin = pins[0];
            if (!authorizedPin || !pin || pin.account_locked || pin.id !== authorizedPin.id ||
                pin.pin_hash !== authorizedPin.pin_hash || pin.hash_algorithm !== authorizedPin.hash_algorithm || pin.pin_version !== authorizedPin.pin_version ||
                pin.last_changed_at !== authorizedPin.last_changed_at) {
              throw new UnauthorizedException('Agent PIN changed or was revoked during claim');
            }
          }

          // If already CLAIMED, handle idempotency
          if (transfer.status === 'EXPIRED') {
            throw new ConflictException('Transfer has expired and cannot be claimed');
          }

          if (transfer.status === 'CLAIMED') {
            if (transfer.claim_idempotency_key === idempotencyKey && transfer.claim_journal_id) {
              const settlementWalletForHash = await this.resolveWalletAccount(manager, settlementWalletOwnerId);
              const fingerprintInput: ClaimRequestFingerprintInput = {
                transferId,
                beneficiaryPhone: canonicalPhone,
                claimantCustomerId: customerId,
                claimantAgentId,
                redemptionMethod,
                principalMinor: transfer.principal_minor,
                currency: transfer.currency,
                unclaimedAccountId: unclaimedAccount.id,
                settlementWalletLedgerId: settlementWalletForHash.ledgerAccountId,
                reference,
                correlationId: correlationId ?? null,
                metadata: input.metadata ?? {},
              };
              const expectedHash = this.computeClaimRequestHash(fingerprintInput);
              const legacyWalletHash = redemptionMethod === 'CUSTOMER_WALLET'
                ? this.computeLegacyWalletClaimRequestHash(fingerprintInput)
                : null;
              const idemRows: Array<{ request_hash: string; response_body: any }> = await manager.query(
                `SELECT request_hash, response_body FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2 LIMIT 1`,
                [scope, idempotencyKey],
              );
              const storedHash = idemRows[0]?.request_hash;
              if (
                storedHash &&
                storedHash !== expectedHash &&
                storedHash !== legacyWalletHash
              ) {
                throw new ConflictException('Idempotency key already used with different financial parameters');
              }
              const result: AgentCashToCashClaimResult = {
                status: 'REPLAYED',
                transferId,
                journalId: transfer.claim_journal_id!,
                beneficiaryPhone: transfer.beneficiary_phone,
                principalMinor: transfer.principal_minor,
                currency: transfer.currency,
                amountMinor: transfer.principal_minor,
                claimantCustomerId: transfer.claimant_customer_id!,
                redemptionMethod,
                idempotencyKey,
                requestHash: storedHash ?? expectedHash,
                replayed: true,
                correlationId,
                reference: transfer.claim_journal_id ? reference : undefined,
                claimedAt: new Date(transfer.claim_journal_id ? (await manager.query(`SELECT created_at FROM ledger_journals WHERE id=$1`, [transfer.claim_journal_id]))[0]?.created_at ?? new Date() : new Date()),
              };
              return result;
            }
            throw new ConflictException('Transfer already claimed');
          }

          if (transfer.status !== 'UNCLAIMED') {
            throw new ConflictException(`Transfer status ${transfer.status} cannot be claimed`);
          }

          // A pre-check can pass and then spend time on Customer OTP verification before this
          // transaction acquires the row lock. Compare against the database wall clock only
          // after locking, so PostgreSQL transaction-start timestamps cannot let a request that
          // waited past the deadline settle stale funds.
          const deadlineRows: Array<{ is_expired: boolean }> = await manager.query(
            `SELECT expires_at <= clock_timestamp() AS is_expired
             FROM cash_to_cash_transfers WHERE id=$1`,
            [transferId],
          );
          if (deadlineRows[0]?.is_expired) {
            throw new ConflictException('Transfer has expired and cannot be claimed');
          }

          // Re-check Agent lifecycle, class status, and CASH_TO_CASH permission under the same
          // transaction that will post the cash-payout ledger entry. The earlier PIN check alone
          // is not sufficient if the Agent/class is disabled while the Customer verifies OTP.
          const claimantAgentClassId = redemptionMethod === 'AGENT_CASH'
            ? await this.assertAgentCashCapabilityWithManager(manager, claimantAgentId!)
            : null;

          if (transfer.is_locked) {
            throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
          }

          if (transfer.beneficiary_phone !== canonicalPhone) {
            throw new BadRequestException('Beneficiary phone does not match transfer');
          }

          // V1-SYSTEM-01: re-check inside the SERIALIZABLE transaction in case the claimant's
          // own contact methods changed between the pre-check and the lock (mirrors how every
          // other pre-check in this flow is duplicated here).
          await this.assertClaimantOwnsBeneficiaryPhone(manager, customerId, canonicalPhone);

          // Freeze customer and current assessment evidence through financial commit.
          await manager.query(`SELECT id FROM customers WHERE id=$1 FOR SHARE`, [customerId]);
          await manager.query(`SELECT id FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=TRUE FOR SHARE`, [customerId]);

          // Identity already verified outside, but re-check inside for consistency (in case customer changed)
          const custRows2: Array<{ id: string; status: string; kyc_status: string; deleted_at: string | null }> = await manager.query(
            `SELECT id, status, kyc_status, deleted_at FROM customers WHERE id=$1 LIMIT 1`,
            [customerId],
          );
          const customer2 = custRows2[0];
          if (!customer2 || customer2.deleted_at !== null) throw new NotFoundException(`Customer ${customerId} not found`);
          if (customer2.status !== 'ACTIVE') throw new NotFoundException(`Customer ${customerId} not found`);
          let kycApprovalEvidence: { assessmentId: string; assessedBy: string } | null = null;
          if (redemptionMethod === 'AGENT_CASH') {
            kycApprovalEvidence = await this.assertCurrentApprovedKyc(manager, customerId);
          } else if (customer2.kyc_status !== 'APPROVED') {
            // Re-check the authoritative status inside the settlement transaction; an identity
            // document row alone has no review state and is not proof of verified identity.
            throw new ForbiddenException('Claimant identity not verified (KYC not APPROVED)');
          }

          if (redemptionMethod === 'CUSTOMER_WALLET') {
            await this.assertWalletAssessmentUnexpired(manager, customerId);
          }

          // Code already verified outside, but re-verify inside with timingSafeEqual for binding (in case hash changed)
          const codeValid = this.verifyTransferCode(transferCode, transfer.transfer_code_hash);
          if (!codeValid) {
            // This should have been caught outside, but handle concurrently changed hash
            // Persist outside the rolled-back posting transaction using an atomic increment.
            const err: any = new UnauthorizedException('Transfer code invalid');
            err.failedCodeHash = transfer.transfer_code_hash;
            err.transferId = transferId;
            throw err;
          }

          // Resolve only the server-owned destination selected by the mode: beneficiary Customer
          // wallet or authenticated Agent B float. No client-provided account id is accepted.
          const settlementWallet = await this.resolveWalletAccount(manager, settlementWalletOwnerId);

          // V1-LIMIT-04: enforce the incoming side for the destination owner. Wallet mode applies
          // Customer limits; Agent-cash mode applies Agent B's assigned class/profile limits.
          let limitIdempotencyKeyForClaim: string | null = null;
          let claimRequestHashForLimit: string | null = null;
          let limitOutcome: EnforceResult | null = null;
          const limitPrincipalType = redemptionMethod === 'AGENT_CASH' ? 'AGENT' : 'CUSTOMER';
          const limitPrincipalId = redemptionMethod === 'AGENT_CASH' ? claimantAgentId! : customerId;
          const claimRequestHashEarly = this.computeClaimRequestHash({
            transferId,
            beneficiaryPhone: canonicalPhone,
            claimantCustomerId: customerId,
            claimantAgentId,
            redemptionMethod,
            principalMinor: transfer.principal_minor,
            currency: transfer.currency,
            unclaimedAccountId: unclaimedAccount.id,
            settlementWalletLedgerId: settlementWallet.ledgerAccountId,
            reference,
            correlationId: correlationId ?? null,
            metadata: input.metadata ?? {},
          });
          if (this.limitEnforcementService) {
            limitIdempotencyKeyForClaim = idempotencyKey;
            claimRequestHashForLimit = claimRequestHashEarly;
            try {
              limitOutcome = await this.limitEnforcementService.enforceWithManager(manager, {
                principalType: limitPrincipalType,
                principalId: limitPrincipalId,
                agentClassId: redemptionMethod === 'AGENT_CASH' ? claimantAgentClassId : null,
                product: 'CASH_TO_CASH',
                currency: transfer.currency,
                direction: 'INCOMING',
                channel: null,
                amountMinor: transfer.principal_minor,
                idempotencyKey: limitIdempotencyKeyForClaim,
                requestHash: claimRequestHashForLimit,
                correlationId: correlationId ?? null,
                now: new Date(),
                walletLedgerAccountId: settlementWallet.ledgerAccountId,
                principalWalletCustomerId: settlementWalletOwnerId,
              });
            } catch (error) {
              if (error instanceof HttpException) {
                const resp: any = error.getResponse();
                const code = (resp && (resp.error || resp.code)) as string | undefined;
                if (code && String(code).startsWith('LIMIT_')) throw error;
              }
              throw error;
            }
          }

          // Bind the destination and method to the idempotency fingerprint; secrets stay excluded.
          const requestHash = this.computeClaimRequestHash({
            transferId,
            beneficiaryPhone: canonicalPhone,
            claimantCustomerId: customerId,
            claimantAgentId,
            redemptionMethod,
            principalMinor: transfer.principal_minor,
            currency: transfer.currency,
            unclaimedAccountId: unclaimedAccount.id,
            settlementWalletLedgerId: settlementWallet.ledgerAccountId,
            reference,
            correlationId: correlationId ?? null,
            metadata: input.metadata ?? {},
          });

          // Idempotency reservation for claim
          const reservation = await this.idempotencyService.reserve(manager, {
            scope,
            key: idempotencyKey,
            requestHash,
            retentionSeconds: RETENTION_SECONDS,
          });

          if (reservation.kind === 'REPLAY') {
            const existing = reservation.record;
            if (existing.requestHash !== requestHash) {
              throw new ConflictException('Idempotency key already used with different request');
            }
            const body = existing.responseBody as unknown as AgentCashToCashClaimResult | null;
            if (body && (body as any).journalId) {
              const claimed = await manager.query(`SELECT claim_journal_id, claimant_customer_id FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
              if (claimed[0]?.claim_journal_id === (body as any).journalId) {
                return { ...(body as any), status: 'REPLAYED' as const, replayed: true };
              }
              return { ...(body as any), status: 'REPLAYED' as const, replayed: true, journalId: existing.resourceId ?? (body as any).journalId } as AgentCashToCashClaimResult;
            }
            if (existing.resourceId) {
              return {
                status: 'REPLAYED',
                transferId,
                journalId: existing.resourceId,
                beneficiaryPhone: transfer.beneficiary_phone,
                principalMinor: transfer.principal_minor,
                currency: transfer.currency,
                amountMinor: transfer.principal_minor,
                claimantCustomerId: customerId,
                redemptionMethod,
                idempotencyKey,
                requestHash,
                replayed: true,
                correlationId,
                reference,
                claimedAt: existing.updatedAt,
              };
            }
            throw new ConflictException('Idempotency replay missing resource linkage');
          }

          // Financial: one atomic redemption. Wallet mode credits the beneficiary Customer;
          // Agent-cash mode credits Agent B's float against the physical cash handover.
          const principal = transfer.principal_minor;
          const lines = [
            { accountId: unclaimedAccount.id, direction: LedgerEntryDirection.DEBIT as const, amountMinor: principal },
            { accountId: settlementWallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT as const, amountMinor: principal },
          ];

          const ledgerIdempotencyKey = `claim:${transferId}:${idempotencyKey}`;
          let journalId: string;
          try {
            journalId = await this.ledgerService.postJournalInTransaction(manager, {
              idempotencyKey: ledgerIdempotencyKey,
              currency: transfer.currency,
              accountingUnit: 'CUSTOMER_FUNDS',
              reference,
              description,
              correlationId,
              metadata: {
                ...(input.metadata ?? {}),
                operation: 'CASH_TO_CASH_CLAIM',
                transferId,
                redemptionMethod,
                beneficiaryPhone: canonicalPhone,
                claimantCustomerId: customerId,
                claimantAgentId,
                destinationOwnerId: settlementWalletOwnerId,
                identityVerificationMethod: redemptionMethod === 'AGENT_CASH'
                  ? 'CURRENT_APPROVED_KYC_ASSESSMENT'
                  : null,
                kycAssessmentId: kycApprovalEvidence?.assessmentId ?? null,
                kycAssessedBy: kycApprovalEvidence?.assessedBy ?? null,
                agentClassId: claimantAgentClassId,
                principalMinor: principal,
                currency: transfer.currency,
                idempotencyKey,
                requestHash,
              },
              lines: lines.map((l) => ({
                accountId: l.accountId,
                direction: l.direction as LedgerEntryDirection,
                amountMinor: l.amountMinor,
              })),
            });
          } catch (error) {
            if (limitIdempotencyKeyForClaim && this.limitEnforcementService) {
              try {
                await this.limitEnforcementService.releaseReservationsWithManager(manager, limitIdempotencyKeyForClaim);
              } catch {}
            }
            throw error;
          }

          if (limitIdempotencyKeyForClaim && this.limitEnforcementService) {
            // Limit usage and settlement must commit together. A failed usage update must
            // roll back the journal, not silently permit a payout with unaccounted limits.
            await this.limitEnforcementService.commitReservationsWithManager(manager, limitIdempotencyKeyForClaim);
          }

          // Re-evaluate wall-clock expiry after potentially slow ledger/limit work. Row
          // locks already prevent revocation/rotation from committing ahead of this claim.
          if (input.claimantPrincipal) {
            await this.assertAgentSessionWithManager(manager, input.claimantPrincipal);
          }

          // Honour explicit evidence expiry even if it elapsed during ledger locking.
          if (redemptionMethod === 'AGENT_CASH') {
            await this.assertCurrentApprovedKyc(manager, customerId);
          } else {
            await this.assertWalletAssessmentUnexpired(manager, customerId);
          }

          // Update transfer to CLAIMED
          // Ledger/account locks or limit evaluation may have waited beyond the earlier
          // deadline check. Gate the terminal transition on the database wall clock too;
          // rejection rolls back the journal and limit usage in this transaction.
          const settled: Array<{ id: string }> = await manager.query(
            `WITH settled AS (UPDATE cash_to_cash_transfers SET status='CLAIMED', claimed_at=clock_timestamp(), claimant_customer_id=$1, claim_journal_id=$2, claim_idempotency_key=$3, claim_reference=$4, failed_attempts=0, is_locked=FALSE, locked_at=NULL, lock_reason=NULL, updated_at=NOW() WHERE id=$5 AND status='UNCLAIMED' AND expires_at > clock_timestamp() RETURNING id) SELECT id FROM settled`,
            [customerId, journalId, idempotencyKey, reference, transferId],
          );
          if (settled.length !== 1) {
            throw new ConflictException('Transfer has expired and cannot be claimed');
          }

          // — V1-COMMERCIAL-DECISION-03C: record the immutable commercial decision snapshot for
          // the CLAIM operation inside this same SERIALIZABLE transaction, after the claim journal
          // posted, limits committed, and the transfer flipped to CLAIMED — before idempotency
          // completion. Commits/rolls back atomically with the claim financial movement.
          // NO fee is charged: NOT_CONFIGURED. Distinct from the initiation snapshot (AGENT
          // OUTGOING identity) — both keep the canonical CASH_TO_CASH product code.
          await this.recordCommercialDecisionSnapshot(manager, {
            customerId,
            principalType: redemptionMethod === 'AGENT_CASH' ? 'AGENT' : 'CUSTOMER',
            principalId: redemptionMethod === 'AGENT_CASH' ? claimantAgentId! : customerId,
            transferId,
            amountMinor: principal,
            currency: transfer.currency,
            journalId,
            idempotencyKey,
            correlationId: correlationId ?? null,
            limitOutcome,
          });

          // Simulate failure after journal for rollback test (inside same transaction, so claim
          // journal, limits, transfer status, and snapshot all roll back)
          if (input._simulateFailureAfterJournal) {
            throw new BadRequestException('Simulated failure after journal');
          }

          const result: AgentCashToCashClaimResult = {
            status: 'COMPLETED',
            transferId,
            journalId,
            beneficiaryPhone: canonicalPhone,
            principalMinor: principal,
            currency: transfer.currency,
            amountMinor: principal,
            claimantCustomerId: customerId,
            redemptionMethod,
            idempotencyKey,
            requestHash,
            replayed: false,
            correlationId,
            reference,
            claimedAt: new Date(),
          };

          await this.idempotencyService.complete(manager, reservation.record.id, {
            statusCode: 200,
            responseBody: result as unknown as Record<string, unknown>,
            resourceType: 'CASH_TO_CASH_CLAIM',
            resourceId: journalId,
          });

          await this.auditService.record(manager, {
            entityType: 'AGENT_CASH_TO_CASH_CLAIM',
            entityId: journalId,
            action: 'CASH_TO_CASH_CLAIMED',
            actor: claimantActor,
            correlationId,
            newValues: {
              transferId,
              redemptionMethod,
              beneficiaryPhone: canonicalPhone,
              claimantCustomerId: customerId,
              claimantAgentId,
              destinationOwnerId: settlementWalletOwnerId,
              identityVerificationMethod: redemptionMethod === 'AGENT_CASH'
                ? 'CURRENT_APPROVED_KYC_ASSESSMENT'
                : null,
              kycAssessmentId: kycApprovalEvidence?.assessmentId ?? null,
              kycAssessedBy: kycApprovalEvidence?.assessedBy ?? null,
              agentClassId: claimantAgentClassId,
              principalMinor: principal,
              currency: transfer.currency,
              journalId,
              idempotencyKey,
              requestHash,
              reference,
              correlationId: correlationId ?? null,
              status: 'CLAIMED',
            },
          });

          return result;
        });
      } catch (error: any) {
        if (error?.failedCodeHash && error?.transferId) {
          if (await this.recordFailedCode(error.transferId, error.failedCodeHash)) {
            throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
          }
          throw new UnauthorizedException('Transfer code invalid');
        }
        if (isRetryableTransactionError(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) {
            continue;
          }
          throw this.transactionContentionExhaustedException();
        }
        throw error;
      }
    }
    throw this.transactionContentionExhaustedException();
  }

  /**
   * Recover a committed Customer-wallet or Agent-cash settlement after the original HTTP response
   * was lost. The immutable audit event binds recovery to the same Agent that processed the claim;
   * transfer IDs alone are not sufficient authority to inspect another Agent's desk activity.
   */
  async recoverClaimForAgent(
    transferIdInput: string,
    principal: AuthorizationPrincipal,
  ): Promise<AgentCashToCashClaimResult> {
    const transferId = transferIdInput?.trim().toLowerCase();
    if (!transferId || !UUID_PATTERN.test(transferId)) {
      throw new BadRequestException('transferId must be a UUID');
    }
    if (
      principal.type !== 'AGENT' ||
      !principal.agentId ||
      !UUID_PATTERN.test(principal.agentId) ||
      principal.agentId.toLowerCase() !== principal.principalId.toLowerCase()
    ) {
      throw new ForbiddenException('An authenticated Agent is required to recover this claim');
    }

    const rows: Array<{
      transfer_id: string;
      journal_id: string;
      beneficiary_phone: string;
      principal_minor: string;
      currency: string;
      claimant_customer_id: string;
      claim_idempotency_key: string;
      redemption_method: string | null;
      request_hash: string | null;
      reference: string | null;
      correlation_id: string | null;
      claimed_at: Date | string;
    }> = await this.dataSource.query(
      `SELECT t.id::text AS transfer_id,
              t.claim_journal_id::text AS journal_id,
              t.beneficiary_phone,
              t.principal_minor::text AS principal_minor,
              t.currency,
              t.claimant_customer_id::text AS claimant_customer_id,
              t.claim_idempotency_key,
              e.new_values->>'redemptionMethod' AS redemption_method,
              e.new_values->>'requestHash' AS request_hash,
              t.claim_reference AS reference,
              e.correlation_id,
              t.claimed_at
       FROM cash_to_cash_transfers t
       JOIN audit_events e
         ON e.entity_type='AGENT_CASH_TO_CASH_CLAIM'
        AND e.action='CASH_TO_CASH_CLAIMED'
        AND e.entity_id=t.claim_journal_id
        AND e.actor=$2
       WHERE t.id=$1 AND t.status='CLAIMED'
       ORDER BY e.occurred_at DESC
       LIMIT 1`,
      [transferId, principal.agentId.toLowerCase()],
    );
    const claim = rows[0];
    if (!claim) throw new NotFoundException('Cash-to-Cash claim not found for this Agent');

    return {
      status: 'REPLAYED',
      transferId: claim.transfer_id,
      journalId: claim.journal_id,
      beneficiaryPhone: claim.beneficiary_phone,
      principalMinor: claim.principal_minor,
      currency: claim.currency,
      amountMinor: claim.principal_minor,
      claimantCustomerId: claim.claimant_customer_id,
      redemptionMethod: claim.redemption_method === 'AGENT_CASH' ? 'AGENT_CASH' : 'CUSTOMER_WALLET',
      idempotencyKey: claim.claim_idempotency_key,
      requestHash: claim.request_hash ?? '',
      replayed: true,
      ...(claim.correlation_id ? { correlationId: claim.correlation_id } : {}),
      ...(claim.reference ? { reference: claim.reference } : {}),
      claimedAt: new Date(claim.claimed_at),
    };
  }

  private async assertAgentSessionWithManager(
    manager: EntityManager,
    principal: AuthorizationPrincipal,
  ): Promise<void> {
    if (!principal.sessionId || !UUID_PATTERN.test(principal.sessionId)) {
      throw new UnauthorizedException('A current Agent session is required for this claim');
    }
    // Lock the Agent first, matching session issuance and lifecycle revocation. This
    // also rejects a deleted/non-ACTIVE Agent if status changes after the HTTP guard.
    const agents = await manager.query(
      `SELECT id FROM agents WHERE id=$1 AND status='ACTIVE' AND deleted_at IS NULL FOR SHARE`,
      [principal.agentId],
    );
    if (agents.length !== 1) throw new UnauthorizedException('Agent session expired or revoked during claim');
    // Lock credential and session evidence until commit so logout, credential reissue,
    // account locking and lifecycle revocation serialize with posting.
    const rows = await manager.query(
      `SELECT s.id,
              (s.status='ACTIVE' AND s.revoked_at IS NULL AND s.audience='agent-api'
               AND s.expires_at > clock_timestamp()
               AND c.status='ACTIVE' AND c.deleted_at IS NULL
               AND c.rotation_required=FALSE AND c.account_locked=FALSE
               AND (c.password_expires_at IS NULL OR c.password_expires_at > clock_timestamp())
               AND s.issued_at >= c.password_changed_at) AS eligible
       FROM agent_authentication_credentials c
       JOIN agent_authentication_sessions s ON s.credential_id=c.id AND s.agent_id=c.agent_id
       WHERE s.id=$1 AND s.agent_id=$2 FOR SHARE OF c, s`,
      [principal.sessionId, principal.agentId],
    );
    if (rows[0]?.eligible !== true) {
      throw new UnauthorizedException('Agent session expired or revoked during claim');
    }
  }

  private async assertAgentCashRedemptionAuthorization(
    agentId: string,
    agentPin: string,
    principal: AuthorizationPrincipal,
  ): Promise<void> {
    const authResult = await this.agentAuthorizationService.authorize({
      agentId,
      service: AgentService.CASH_TO_CASH,
      pin: agentPin,
      principal,
    });
    if (authResult.allowed && authResult.context) return;

    const reason = authResult.reason;
    if (reason === 'PIN_REQUIRED' || reason === 'PIN_INVALID' || reason === 'PIN_NOT_FOUND') {
      throw new UnauthorizedException(`Agent PIN invalid: ${reason}`);
    }
    if (reason === 'PIN_LOCKED') throw new UnauthorizedException('Agent PIN is locked');
    if (
      reason === 'PRINCIPAL_MISMATCH' ||
      reason === 'PRINCIPAL_NOT_AGENT' ||
      reason === 'WORKFORCE_NOT_PERMITTED' ||
      reason === 'UNAUTHENTICATED'
    ) {
      throw new ForbiddenException(`Authorization denied: ${reason}`);
    }
    if (
      reason === 'AGENT_PENDING' ||
      reason === 'AGENT_SUSPENDED' ||
      reason === 'AGENT_TERMINATED' ||
      reason === 'AGENT_NOT_FOUND' ||
      reason === 'AGENT_DELETED' ||
      reason === 'AGENT_NOT_ACTIVE'
    ) {
      throw new ForbiddenException(`Agent not permitted: ${reason}`);
    }
    if (reason === 'SERVICE_NOT_PERMITTED' || reason === 'UNKNOWN_SERVICE') {
      throw new ForbiddenException('Agent does not have CASH_TO_CASH capability');
    }
    if (
      reason === 'AGENT_CLASS_INACTIVE' ||
      reason === 'MISSING_AGENT_CLASS' ||
      reason === 'AGENT_CLASS_NOT_FOUND' ||
      reason === 'AGENT_CLASS_DELETED'
    ) {
      throw new ForbiddenException(`Agent class invalid: ${reason}`);
    }
    throw new ForbiddenException(`Authorization denied: ${reason}`);
  }

  // V1-INFRA-03: mirrors the established house convention in
  // AgentCashToCashService.transactionContentionExhaustedException() — a stable, documented
  // machine code (`TRANSACTION_CONTENTION_RETRY_EXHAUSTED`) set as both `error` and `code` in
  // the response body, plus `.code` directly on the exception instance.
  private transactionContentionExhaustedException(): ConflictException {
    const code = 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED';
    const message = 'Cash→Cash claim could not complete after concurrent retries';
    const exception = new ConflictException({ message, error: code, code });
    (exception as unknown as { code?: string }).code = code;
    return exception;
  }

  /**
   * V1-COMMERCIAL-DECISION-03C — CASH_TO_CASH CLAIM commercial snapshot capture.
   *
   * Runs inside the existing SERIALIZABLE claim transaction via
   * `recordDecisionWithManager` (never `recordDecision`, which opens its own transaction).
   * Read-only fee resolution via `FeeRuleResolverService.resolveWithManager` participates in the
   * same transaction; its result is EVIDENCE ONLY — no fee is calculated or charged and the
   * ledger is untouched by this method. Mirrors the proven pilot semantics:
   *  - fee decision stays NOT_CONFIGURED while V1 is fee-free (never ZERO); resolved rule
   *    evidence (ruleId/ruleVersion/effective parameters) is captured in fee_decision.ruleRefs
   *  - commission/reward NONE, revenue null, configurationVersion null — nothing invented
   *  - limit evidence comes from the authoritative EnforceResult of THIS claim
   *    (destination-owner INCOMING — Customer for wallet redemption, Agent for cash redemption)
   *  - describes the CLAIM operation only; the earlier initiation keeps its own snapshot
   *    (AGENT OUTGOING identity) under the same canonical CASH_TO_CASH product code
   */
  private async recordCommercialDecisionSnapshot(
    manager: EntityManager,
    ctx: {
      customerId: string;
      principalType: 'CUSTOMER' | 'AGENT';
      principalId: string;
      transferId: string;
      amountMinor: string;
      currency: string;
      journalId: string;
      idempotencyKey: string;
      correlationId: string | null;
      limitOutcome: EnforceResult | null;
    },
  ): Promise<void> {
    if (!this.feeRuleResolverService || !this.commercialDecisionSnapshotService) return;
    if (!UUID_PATTERN.test(ctx.customerId)) return;

    const productCode = 'CASH_TO_CASH';
    const decisionAt = new Date();

    const resolution = await this.feeRuleResolverService.resolveWithManager(manager, {
      productCode,
      currency: ctx.currency,
      at: decisionAt,
    });

    // V1-COMMERCIAL-IMPLEMENTATION-01 — authoritative fee computation (single calculator authority);
    // legacy inline evidence retained only for calculator-absent (manual-construction) wiring.
    let feeDecision: Record<string, unknown>;
    if (this.feeRuleCalculatorService) {
      feeDecision = {
        ...this.feeRuleCalculatorService.compute({
          resolution,
          principalAmountMinor: ctx.amountMinor,
          currency: ctx.currency,
        }),
      // flow evidence (allowed by the snapshot's jsonb contract) — transfer identity of the claim
      transferId: ctx.transferId,
      };
    } else {
      feeDecision = {
        ...feeNotConfigured(ctx.currency, ctx.amountMinor),
        // flow evidence (allowed by the snapshot's jsonb contract) — transfer identity of the claim
        transferId: ctx.transferId,
      };
      if (resolution.status === 'RESOLVED' && resolution.rule) {
        feeDecision.ruleRefs = [
          {
            ruleId: resolution.rule.ruleId,
            ruleVersion: resolution.rule.ruleVersion,
            flatFeeMinor: resolution.rule.flatFeeMinor,
            percentageBps: resolution.rule.percentageBps,
            minimumFeeMinor: resolution.rule.minimumFeeMinor,
            maximumFeeMinor: resolution.rule.maximumFeeMinor,
            vatBps: resolution.rule.vatBps,
            effectiveFrom: resolution.rule.effectiveFrom.toISOString(),
            effectiveTo: resolution.rule.effectiveTo === null ? null : resolution.rule.effectiveTo.toISOString(),
            priority: resolution.rule.priority,
          },
        ];
      } else if (resolution.status === 'AMBIGUOUS') {
        feeDecision.resolutionStatus = 'AMBIGUOUS';
        feeDecision.ambiguousRuleIds = resolution.ambiguousRuleIds ?? [];
      }
    }

    const limitDecision = ctx.limitOutcome
      ? limitApproved({
          profileCode: ctx.limitOutcome.limitProfileCode ?? null,
          assignmentId: ctx.limitOutcome.assignmentId ?? null,
          ruleRefs: (ctx.limitOutcome.ruleRefs ?? []).map((r) => ({
            ruleId: r.ruleId,
            dimension: r.dimension,
            limitValueMinor: r.limitValueMinor,
            limitValueCount: r.limitValueCount,
          })),
          reservationIds: ctx.limitOutcome.reservationIds ?? [],
          usageIds: ctx.limitOutcome.usageIds ?? [],
        })
      : limitNotEvaluated();

    await this.commercialDecisionSnapshotService.recordDecisionWithManager(manager, {
      idempotencyKey: `cash-to-cash-claim:${ctx.transferId}:${ctx.idempotencyKey}`,
      product: productCode,
      direction: 'INCOMING',
      channel: null,
      principalType: ctx.principalType,
      principalId: ctx.principalId,
      currency: ctx.currency,
      principalAmountMinor: ctx.amountMinor,
      transactionReference: ctx.journalId,
      correlationId: ctx.correlationId,
      journalId: ctx.journalId,
      decisionStatus: 'FINAL',
      decidedAt: decisionAt,
      finalizedAt: decisionAt,
      feeDecision: feeDecision as never,
      // V1-COMMERCIAL-IMPLEMENTATION-02 — the CLAIM is deliberately NOT a commission event. One
      // CASH_TO_CASH transfer = ONE economic commission decision, recorded at INITIATION (the only
      // commissionable stage under the existing V1 decision; see agent-cash-to-cash.service.ts,
      // commissionEvent 'CASH_TO_CASH_INITIATION'). Agent B may facilitate wallet or cash redemption,
      // but claim settlement does not create a second Agent commission. The CommissionRuleResolver/
      // CommissionEngine is intentionally not invoked here, preventing a second allocation for the
      // same transfer. The static guarantee is asserted by test 02 of v1-commission-01 and the
      // product-lifecycle test 22 of v1-commission-runtime-wiring (exactly one allocation across
      // initiation+claim).
      commissionDecision: commissionNone(),
      rewardDecision: rewardNone(),
      limitDecision,
      revenueDecision: null,
      configurationVersion: null,
      createdBy: 'agent-cash-to-cash-claim',
    });
  }

  // V1-SYSTEM-01 (critical fix): verifies that `customerId` (the claimant) actually owns a
  // verified, primary phone number equal to the transfer's `canonicalPhone`. This is the
  // control that was previously entirely missing: the `beneficiaryPhone` request parameter
  // alone only proves the caller typed the right digits, and the agent-desk OTP alone only
  // proves the caller controls `customerId`'s OWN phone (it is never sent to an arbitrary
  // target phone) — neither proves the claimant is the transfer's intended recipient. Fails
  // closed (generic NotFoundException, matching the existing no-enumeration-leak pattern used
  // for every other pre-check in this flow) if the claimant has no verified primary phone or
  // it does not match. Accepts either `this.dataSource` or a transaction `manager` so it can be
  // called both in the pre-check phase and again inside the SERIALIZABLE re-check.
  private async assertClaimantOwnsBeneficiaryPhone(
    queryable: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
    customerId: string,
    canonicalPhone: string,
  ): Promise<void> {
    const rows: Array<{ value: string }> = await queryable.query(
      `SELECT value FROM customer_contact_methods
       WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND verified_at IS NOT NULL AND deleted_at IS NULL
       LIMIT 1`,
      [customerId],
    );
    const ownPhoneRaw = rows[0]?.value;
    const ownPhoneCanonical = ownPhoneRaw ? AgentReceivingNumberService.canonicalizeTo10(ownPhoneRaw) : null;
    if (!ownPhoneCanonical || ownPhoneCanonical !== canonicalPhone) {
      throw new NotFoundException(`Cash→Cash transfer not found`);
    }
  }

  /**
   * Re-check the cash-claim Agent's current lifecycle and class policy under the settlement
   * transaction. SHARE locks prevent the Agent or class policy changing between the check and
   * the atomic ledger/state commit.
   */
  private async assertAgentCashCapabilityWithManager(
    manager: EntityManager,
    agentId: string,
  ): Promise<string> {
    const agentRows: Array<{
      status: string;
      deleted_at: string | null;
      agent_class_id: string | null;
    }> = await manager.query(
      `SELECT status, deleted_at, agent_class_id::text AS agent_class_id
       FROM agents WHERE id=$1 FOR SHARE`,
      [agentId],
    );
    const agent = agentRows[0];
    if (!agent || agent.deleted_at !== null || agent.status !== 'ACTIVE' || !agent.agent_class_id) {
      throw new ForbiddenException('Agent is not eligible for Cash-to-Cash cash redemption');
    }

    const classRows: Array<{
      id: string;
      is_active: boolean;
      deleted_at: string | null;
      applicable_services: unknown;
    }> = await manager.query(
      `SELECT id::text AS id, is_active, deleted_at, applicable_services
       FROM agent_classes WHERE id=$1 FOR SHARE`,
      [agent.agent_class_id],
    );
    const agentClass = classRows[0];
    if (!agentClass || agentClass.deleted_at !== null || !agentClass.is_active) {
      throw new ForbiddenException('Agent class is not active for Cash-to-Cash cash redemption');
    }
    if (!Array.isArray(agentClass.applicable_services) || agentClass.applicable_services.length === 0) {
      throw new ForbiddenException('Agent class does not permit Cash-to-Cash cash redemption');
    }
    const services = agentClass.applicable_services.map((entry) =>
      typeof entry === 'string' ? normalizeAgentService(entry) : null,
    );
    if (services.some((service) => service === null)) {
      throw new ForbiddenException('Agent class has invalid service configuration');
    }
    if (!services.includes(AgentService.CASH_TO_CASH)) {
      throw new ForbiddenException('Agent class does not permit Cash-to-Cash cash redemption');
    }
    return agentClass.id;
  }

  /** Existing approval is required; honour any explicit current-assessment expiry.
   * Do not invent a freshness period or require a new assessment for legacy APPROVED
   * customers with no assessment row. That separate product decision remains open.
   */
  private async assertWalletAssessmentUnexpired(
    queryable: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
    customerId: string,
  ): Promise<void> {
    const rows = await queryable.query(
      `SELECT (kyc_status='APPROVED' AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS eligible
       FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=TRUE`,
      [customerId],
    );
    if (rows.some((row) => row.eligible !== true)) {
      throw new ForbiddenException('Wallet redemption KYC assessment is not approved or has expired');
    }
  }

  /**
   * Cash payout requires a current approved Customer KYC assessment. `assessed_by` is preserved
   * as audit provenance, but the schema does not classify the actor type or prove human review or
   * in-person inspection; a `SERVICE` actor must not be represented as a human supervisor. The
   * identity-document table has no review state, so a bare document row is not verification evidence.
   * Respect explicit `expires_at` when present; no new age/freshness window is added.
   */
  private async assertCurrentApprovedKyc(
    queryable: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
    customerId: string,
  ): Promise<{ assessmentId: string; assessedBy: string }> {
    const rows: Array<{
      customer_status: string;
      customer_kyc_status: string;
      deleted_at: string | null;
      assessment_id: string | null;
      assessment_kyc_status: string | null;
      assessment_expires_at: Date | string | null;
      assessment_unexpired: boolean | null;
      assessed_by: string | null;
    }> = await queryable.query(
      `SELECT c.status AS customer_status,
              c.kyc_status AS customer_kyc_status,
              c.deleted_at,
              a.id::text AS assessment_id,
              a.kyc_status AS assessment_kyc_status,
              a.expires_at AS assessment_expires_at,
              (a.expires_at IS NULL OR a.expires_at > clock_timestamp()) AS assessment_unexpired,
              a.assessed_by
       FROM customers c
       LEFT JOIN customer_kyc_assessments a
         ON a.customer_id=c.id AND a.is_current=TRUE
       WHERE c.id=$1
       LIMIT 1`,
      [customerId],
    );
    const row = rows[0];
    if (!row || row.deleted_at !== null || row.customer_status !== 'ACTIVE') {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    if (
      row.customer_kyc_status !== 'APPROVED' ||
      row.assessment_kyc_status !== 'APPROVED' ||
      !row.assessment_id ||
      row.assessment_unexpired !== true ||
      !row.assessed_by?.trim()
    ) {
      throw new ForbiddenException('Cash payout requires a current approved Customer KYC assessment');
    }
    return { assessmentId: row.assessment_id, assessedBy: row.assessed_by };
  }

  /** One row-locked SQL increment: concurrent failures cannot lose updates or unlock a code. */
  private async recordFailedCode(transferId: string, expectedHash: string): Promise<boolean> {
    const rows: Array<{ is_locked: boolean }> = await this.dataSource.query(
      `WITH failure AS (
         UPDATE cash_to_cash_transfers
         SET failed_attempts=LEAST(failed_attempts + 1, $3),
             is_locked=(failed_attempts + 1 >= $3),
             locked_at=CASE WHEN failed_attempts + 1 >= $3 THEN clock_timestamp() ELSE locked_at END,
             lock_reason=CASE WHEN failed_attempts + 1 >= $3 THEN 'TRANSFER_CODE_LOCKED' ELSE lock_reason END,
             updated_at=clock_timestamp()
         WHERE id=$1 AND transfer_code_hash=$2 AND status='UNCLAIMED' AND is_locked=FALSE
         RETURNING is_locked
       ) SELECT is_locked FROM failure`,
      [transferId, expectedHash, MAX_FAILED_ATTEMPTS],
    );
    if (rows[0]) return rows[0].is_locked;
    const current = await this.dataSource.query(`SELECT is_locked FROM cash_to_cash_transfers WHERE id=$1`, [transferId]);
    return current[0]?.is_locked === true;
  }

  private verifyTransferCode(provided: string, storedHash: string): boolean {
    try {
      // Format: PBKDF2$sha256$10000$salt$derived
      const parts = storedHash.split('$');
      if (parts.length !== 5 || parts[0] !== 'PBKDF2' || parts[1] !== 'sha256') return false;
      const iterations = parseInt(parts[2]!, 10);
      if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;
      const saltB64 = parts[3]!;
      const derivedB64 = parts[4]!;
      const salt = Buffer.from(saltB64, 'base64url');
      const expected = Buffer.from(derivedB64, 'base64url');
      const derived = pbkdf2Sync(provided, salt, iterations, expected.length, 'sha256');
      if (derived.length !== expected.length) return false;
      return timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  private async getUnclaimedAccount(): Promise<LedgerAccount | null> {
    return this.dataSource.getRepository(LedgerAccount).findOne({ where: { code: UNCLAIMED_CODE } });
  }

  private async ensureWalletAccountExists(ownerId: string): Promise<void> {
    const existing = await this.dataSource.getRepository(WalletAccount).findOne({ where: { customerId: ownerId, currency: 'NGN' } });
    if (existing) return;
    try {
      await this.walletService.createWallet({
        customerId: ownerId,
        currency: 'NGN',
        idempotencyKey: `claim-wallet-${ownerId}-NGN-${randomUUID()}`,
      });
    } catch (e) {
      const still = await this.dataSource.getRepository(WalletAccount).findOne({ where: { customerId: ownerId, currency: 'NGN' } });
      if (still) return;
      throw e;
    }
  }

  private async resolveWalletAccount(manager: EntityManager, ownerId: string): Promise<WalletAccount> {
    const repo = manager.getRepository(WalletAccount);
    const wallet: WalletAccount | null = await repo.findOne({
      where: { customerId: ownerId, currency: 'NGN' },
      lock: { mode: 'pessimistic_read' },
    });
    if (wallet) {
      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new ConflictException('Destination wallet is not active');
      }
      return wallet;
    }
    // Fallback only for a snapshot race; the ledger still validates account existence/activity
    // under its own locks before posting. The server never accepts a client-selected account.
    const fallback = await this.dataSource.getRepository(WalletAccount).findOne({ where: { customerId: ownerId, currency: 'NGN' } });
    if (fallback) {
      if (fallback.status !== WalletStatus.ACTIVE) {
        throw new ConflictException('Destination wallet is not active');
      }
      return fallback;
    }
    throw new NotFoundException(`Wallet for destination owner ${ownerId} not found`);
  }

  private computeClaimRequestHash(value: ClaimRequestFingerprintInput): string {
    return this.computeRequestHash(value);
  }

  /** Backward-compatible fingerprint for completed wallet claims created before method tagging. */
  private computeLegacyWalletClaimRequestHash(value: ClaimRequestFingerprintInput): string {
    return this.computeRequestHash({
      transferId: value.transferId,
      beneficiaryPhone: value.beneficiaryPhone,
      claimantCustomerId: value.claimantCustomerId,
      claimantAgentId: value.claimantAgentId,
      principalMinor: value.principalMinor,
      currency: value.currency,
      unclaimedAccountId: value.unclaimedAccountId,
      beneficiaryWalletLedgerId: value.settlementWalletLedgerId,
      reference: value.reference,
      correlationId: value.correlationId,
      metadata: value.metadata,
    });
  }

  private computeRequestHash(value: unknown): string {
    return createHash('sha256').update(this.canonicalJson(value)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.canonicalJson(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${this.canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
}
