/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars */
import { createHash, pbkdf2Sync, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

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
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { isRetryableTransactionError, MAX_SERIALIZABLE_ATTEMPTS } from '../common/serializable-transaction';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import { MfaExecutionService } from '../customer-authentication/mfa-execution.service';
import type { AgentCashToCashClaimInput, AgentCashToCashClaimResult } from './agent-cash-to-cash-claim.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETENTION_SECONDS = 86400;
const UNCLAIMED_CODE = 'CASH_TO_CASH-UNCLAIMED-NGN';
const MAX_FAILED_ATTEMPTS = 5;
const CLAIM_IDEMPOTENCY_PREFIX = 'cash-to-cash-claim.v1:';

@Injectable()
export class AgentCashToCashClaimService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly walletService: WalletService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
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

    // Principal binding if supplied
    if (input.claimantPrincipal) {
      const p: any = input.claimantPrincipal;
      if (p.type === 'AGENT' && p.agentId && p.agentId.toLowerCase() !== p.principalId?.toLowerCase()) {
        // allow but not strict
      }
      if (p.type === 'CUSTOMER' && p.customerId && p.customerId.toLowerCase() !== customerId.toLowerCase()) {
        throw new ForbiddenException('Authenticated customer does not match claimant customerId');
      }
    }

    const reference = input.reference?.trim() ? input.reference.trim() : `CASH_TO_CASH_CLAIM-${idempotencyKey}`;
    const description = input.description?.trim()
      ? input.description.trim()
      : `Cash→Cash claim ${transferId} to ${customerId}`;
    const correlationId = input.correlationId?.trim() ? input.correlationId.trim() : undefined;

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
    }> = await this.dataSource.query(`SELECT id, beneficiary_phone, principal_minor, currency, status, transfer_code_hash, failed_attempts, is_locked FROM cash_to_cash_transfers WHERE id=$1 LIMIT 1`, [transferId]);
    const preTransfer = preTransferRows[0];
    if (!preTransfer) throw new NotFoundException(`Cash→Cash transfer ${transferId} not found`);
    if (preTransfer.status === 'EXPIRED') {
      throw new ConflictException('Transfer has expired and cannot be claimed');
    }
    if (preTransfer.status === 'CLAIMED') {
      // For already claimed, we still need to handle idempotency properly inside transaction (replay vs conflict).
      // We will let the transaction handle it, but we can early return if this is a replay with same key? We'll just continue to OTP+transaction.
    } else {
      if (preTransfer.status !== 'UNCLAIMED') throw new ConflictException(`Transfer status ${preTransfer.status} cannot be claimed`);
      if (preTransfer.is_locked) throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
      if (preTransfer.beneficiary_phone !== canonicalPhone) throw new BadRequestException('Beneficiary phone does not match transfer');
      // Identity verification before OTP (reuse KYC/IdentityDocument)
      const custRows: Array<{ id: string; status: string; kyc_status: string; deleted_at: string | null }> = await this.dataSource.query(
        `SELECT id, status, kyc_status, deleted_at FROM customers WHERE id=$1 LIMIT 1`,
        [customerId],
      );
      const customer = custRows[0];
      if (!customer || customer.deleted_at !== null) throw new NotFoundException(`Customer ${customerId} not found`);
      if (customer.status !== 'ACTIVE') throw new NotFoundException(`Customer ${customerId} not found`);
      if (customer.kyc_status !== 'APPROVED') {
        const docRows: Array<{ id: string }> = await this.dataSource.query(
          `SELECT id FROM customer_identity_documents WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1`,
          [customerId],
        );
        if (docRows.length === 0) throw new ForbiddenException('Claimant identity not verified (KYC not APPROVED and no identity document)');
      }
      // Transfer code verification before OTP (timing-safe, not consuming OTP if code wrong)
      const codeValidPre = this.verifyTransferCode(transferCode, preTransfer.transfer_code_hash);
      if (!codeValidPre) {
        const nextAttempts = (preTransfer.failed_attempts ?? 0) + 1;
        const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
        await this.dataSource.query(
          `UPDATE cash_to_cash_transfers SET failed_attempts=$1, is_locked=$2, locked_at=$3, lock_reason=$4, updated_at=NOW() WHERE id=$5`,
          [nextAttempts, shouldLock, shouldLock ? new Date().toISOString() : null, shouldLock ? 'TRANSFER_CODE_LOCKED' : null, transferId],
        );
        if (shouldLock) throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
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
          // Allow replay: fetch transfer claim details and return REPLAYED
          const claimed: Array<{ claim_journal_id: string; claimant_customer_id: string; beneficiary_phone: string; principal_minor: string; currency: string }> = await this.dataSource.query(
            `SELECT claim_journal_id, claimant_customer_id, beneficiary_phone, principal_minor, currency FROM cash_to_cash_transfers WHERE id=$1`,
            [transferId],
          );
          if (claimed[0]?.claim_journal_id) {
            const body = existingIdem[0].response_body as unknown as AgentCashToCashClaimResult;
            if (body && body.journalId) {
              return { ...body, status: 'REPLAYED' as const, replayed: true };
            }
            return {
              status: 'REPLAYED',
              transferId,
              journalId: claimed[0].claim_journal_id,
              beneficiaryPhone: claimed[0].beneficiary_phone,
              principalMinor: claimed[0].principal_minor,
              currency: claimed[0].currency,
              amountMinor: claimed[0].principal_minor,
              claimantCustomerId: claimed[0].claimant_customer_id,
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

    // Ensure beneficiary wallet exists before SERIALIZABLE so its ledger account is visible to the transaction
    await this.ensureBeneficiaryWalletExists(customerId);

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

          // If already CLAIMED, handle idempotency
          if (transfer.status === 'EXPIRED') {
            throw new ConflictException('Transfer has expired and cannot be claimed');
          }

          if (transfer.status === 'CLAIMED') {
            if (transfer.claim_idempotency_key === idempotencyKey && transfer.claim_journal_id) {
              const beneficiaryWalletForHash = await this.resolveBeneficiaryWallet(manager, customerId);
              const expectedHash = this.computeRequestHash({
                transferId,
                beneficiaryPhone: canonicalPhone,
                claimantCustomerId: customerId,
                principalMinor: transfer.principal_minor,
                currency: transfer.currency,
                unclaimedAccountId: unclaimedAccount.id,
                beneficiaryWalletLedgerId: beneficiaryWalletForHash.ledgerAccountId,
                reference,
                correlationId: correlationId ?? null,
                metadata: input.metadata ?? {},
              });
              const idemRows: Array<{ request_hash: string; response_body: any }> = await manager.query(
                `SELECT request_hash, response_body FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2 LIMIT 1`,
                [scope, idempotencyKey],
              );
              const storedHash = idemRows[0]?.request_hash;
              if (storedHash && storedHash !== expectedHash) {
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

          if (transfer.is_locked) {
            throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
          }

          if (transfer.beneficiary_phone !== canonicalPhone) {
            throw new BadRequestException('Beneficiary phone does not match transfer');
          }

          // Identity already verified outside, but re-check inside for consistency (in case customer changed)
          const custRows2: Array<{ id: string; status: string; kyc_status: string; deleted_at: string | null }> = await manager.query(
            `SELECT id, status, kyc_status, deleted_at FROM customers WHERE id=$1 LIMIT 1`,
            [customerId],
          );
          const customer2 = custRows2[0];
          if (!customer2 || customer2.deleted_at !== null) throw new NotFoundException(`Customer ${customerId} not found`);
          if (customer2.status !== 'ACTIVE') throw new NotFoundException(`Customer ${customerId} not found`);
          if (customer2.kyc_status !== 'APPROVED') {
            const docRows: Array<{ id: string }> = await manager.query(
              `SELECT id FROM customer_identity_documents WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1`,
              [customerId],
            );
            if (docRows.length === 0) throw new ForbiddenException('Claimant identity not verified (KYC not APPROVED and no identity document)');
          }

          // Code already verified outside, but re-verify inside with timingSafeEqual for binding (in case hash changed)
          const codeValid = this.verifyTransferCode(transferCode, transfer.transfer_code_hash);
          if (!codeValid) {
            // This should have been caught outside, but handle concurrently changed hash
            const nextAttempts = (transfer.failed_attempts ?? 0) + 1;
            const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;
            await manager.query(
              `UPDATE cash_to_cash_transfers SET failed_attempts=$1, is_locked=$2, locked_at=$3, lock_reason=$4, updated_at=NOW() WHERE id=$5`,
              [nextAttempts, shouldLock, shouldLock ? new Date().toISOString() : null, shouldLock ? 'TRANSFER_CODE_LOCKED' : null, transferId],
            );
            const err: any = new UnauthorizedException('Transfer code invalid');
            err.nextAttempts = nextAttempts;
            err.shouldLock = shouldLock;
            err.transferId = transferId;
            throw err;
          }

          // Ensure beneficiary wallet exists (for hash & ledger)
          const beneficiaryWallet = await this.resolveBeneficiaryWallet(manager, customerId);

          // V1-LIMIT-04: enforce limits for CUSTOMER INCOMING CASH_TO_CASH claim
          let limitIdempotencyKeyForClaim: string | null = null;
          let claimRequestHashForLimit: string | null = null;
          // V1-COMMERCIAL-DECISION-03C: capture the AUTHORITATIVE enforcement result so the
          // commercial snapshot records what actually governed this claim — never re-evaluated.
          let limitOutcome: EnforceResult | null = null;
          // Compute requestHash early for limit (same as claim's requestHash)
          const claimRequestHashEarly = this.computeRequestHash({
            transferId,
            beneficiaryPhone: canonicalPhone,
            claimantCustomerId: customerId,
            principalMinor: transfer.principal_minor,
            currency: transfer.currency,
            unclaimedAccountId: unclaimedAccount.id,
            beneficiaryWalletLedgerId: beneficiaryWallet.ledgerAccountId,
            reference,
            correlationId: correlationId ?? null,
            metadata: input.metadata ?? {},
          });
          if (this.limitEnforcementService) {
            limitIdempotencyKeyForClaim = idempotencyKey;
            claimRequestHashForLimit = claimRequestHashEarly;
            try {
              limitOutcome = await this.limitEnforcementService.enforceWithManager(manager, {
                principalType: 'CUSTOMER',
                principalId: customerId,
                product: 'CASH_TO_CASH',
                currency: transfer.currency,
                direction: 'INCOMING',
                channel: null,
                amountMinor: transfer.principal_minor,
                idempotencyKey: limitIdempotencyKeyForClaim,
                requestHash: claimRequestHashForLimit,
                correlationId: correlationId ?? null,
                now: new Date(),
                walletLedgerAccountId: beneficiaryWallet.ledgerAccountId,
                principalWalletCustomerId: customerId,
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

          // Compute requestHash for claim idempotency (binds financial fields NOT secrets)
          const requestHash = this.computeRequestHash({
            transferId,
            beneficiaryPhone: canonicalPhone,
            claimantCustomerId: customerId,
            principalMinor: transfer.principal_minor,
            currency: transfer.currency,
            unclaimedAccountId: unclaimedAccount.id,
            beneficiaryWalletLedgerId: beneficiaryWallet.ledgerAccountId,
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

          // Financial: Debit UNCLAIMED, Credit beneficiary wallet
          const principal = transfer.principal_minor;
          const lines = [
            { accountId: unclaimedAccount.id, direction: LedgerEntryDirection.DEBIT as const, amountMinor: principal },
            { accountId: beneficiaryWallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT as const, amountMinor: principal },
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
                beneficiaryPhone: canonicalPhone,
                claimantCustomerId: customerId,
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
            try {
              await this.limitEnforcementService.commitReservationsWithManager(manager, limitIdempotencyKeyForClaim);
            } catch {}
          }

          // Update transfer to CLAIMED
          await manager.query(
            `UPDATE cash_to_cash_transfers SET status='CLAIMED', claimed_at=NOW(), claimant_customer_id=$1, claim_journal_id=$2, claim_idempotency_key=$3, claim_reference=$4, failed_attempts=0, is_locked=FALSE, locked_at=NULL, lock_reason=NULL, updated_at=NOW() WHERE id=$5`,
            [customerId, journalId, idempotencyKey, reference, transferId],
          );

          // — V1-COMMERCIAL-DECISION-03C: record the immutable commercial decision snapshot for
          // the CLAIM operation inside this same SERIALIZABLE transaction, after the claim journal
          // posted, limits committed, and the transfer flipped to CLAIMED — before idempotency
          // completion. Commits/rolls back atomically with the claim financial movement.
          // NO fee is charged: NOT_CONFIGURED. Distinct from the initiation snapshot (AGENT
          // OUTGOING identity) — both keep the canonical CASH_TO_CASH product code.
          await this.recordCommercialDecisionSnapshot(manager, {
            customerId,
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
            actor: customerId,
            correlationId,
            newValues: {
              transferId,
              beneficiaryPhone: canonicalPhone,
              claimantCustomerId: customerId,
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
        if (error?.nextAttempts !== undefined && error?.transferId) {
          try {
            const nextAttempts = error.nextAttempts;
            const shouldLock = error.shouldLock;
            const tid = error.transferId;
            await this.dataSource.query(
              `UPDATE cash_to_cash_transfers SET failed_attempts=$1, is_locked=$2, locked_at=$3, lock_reason=$4, updated_at=NOW() WHERE id=$5`,
              [nextAttempts, shouldLock, shouldLock ? new Date().toISOString() : null, shouldLock ? 'TRANSFER_CODE_LOCKED' : null, tid],
            );
          } catch (_e) { void 0; }
          if (error.shouldLock) throw new ForbiddenException('Transfer code is locked due to too many failed attempts');
          throw new UnauthorizedException('Transfer code invalid');
        }
        if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Cash→Cash claim could not complete after concurrent retries');
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
   *    (CUSTOMER INCOMING — never re-evaluated)
   *  - describes the CLAIM operation only; the earlier initiation keeps its own snapshot
   *    (AGENT OUTGOING identity) under the same canonical CASH_TO_CASH product code
   */
  private async recordCommercialDecisionSnapshot(
    manager: EntityManager,
    ctx: {
      customerId: string;
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
      principalType: 'CUSTOMER',
      principalId: ctx.customerId,
      currency: ctx.currency,
      principalAmountMinor: ctx.amountMinor,
      transactionReference: ctx.journalId,
      correlationId: ctx.correlationId,
      journalId: ctx.journalId,
      decisionStatus: 'FINAL',
      decidedAt: decisionAt,
      finalizedAt: decisionAt,
      feeDecision: feeDecision as never,
      commissionDecision: commissionNone(),
      rewardDecision: rewardNone(),
      limitDecision,
      revenueDecision: null,
      configurationVersion: null,
      createdBy: 'agent-cash-to-cash-claim',
    });
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

  private async ensureBeneficiaryWalletExists(customerId: string): Promise<void> {
    const existing = await this.dataSource.getRepository(WalletAccount).findOne({ where: { customerId, currency: 'NGN' } });
    if (existing) return;
    try {
      await this.walletService.createWallet({
        customerId,
        currency: 'NGN',
        idempotencyKey: `claim-wallet-${customerId}-NGN-${randomUUID()}`,
      });
    } catch (e) {
      const still = await this.dataSource.getRepository(WalletAccount).findOne({ where: { customerId, currency: 'NGN' } });
      if (still) return;
      throw e;
    }
  }

  private async resolveBeneficiaryWallet(manager: any, customerId: string): Promise<WalletAccount> {
    const repo = manager.getRepository(WalletAccount);
    const wallet: WalletAccount | null = await repo.findOne({ where: { customerId, currency: 'NGN' } });
    if (wallet) return wallet;
    // Fallback to dataSource if not visible in this transaction snapshot (should have been ensured before)
    const fallback = await this.dataSource.getRepository(WalletAccount).findOne({ where: { customerId, currency: 'NGN' } });
    if (fallback) return fallback;
    throw new NotFoundException(`Wallet for beneficiary ${customerId} not found`);
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
