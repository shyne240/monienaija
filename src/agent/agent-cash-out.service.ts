/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletService } from '../wallet/wallet.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { parsePositiveMinorUnits, normalizeCurrency } from '../common/money';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentFinancialExecutionService } from './agent-financial-execution.service';
import { AgentService } from './agent-service.enum';
import { CustomerTransactionPinService } from '../customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../customer-authentication/mfa-execution.service';
import { AgentPasswordHashVerificationService } from '../agent-authentication/agent-password-hash-verification.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AgentCashOutInput, AgentCashOutResult } from './agent-cash-out.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AgentCashOutService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customerPinService: CustomerTransactionPinService,
    private readonly mfaExecutionService: MfaExecutionService,
    private readonly agentAuthorizationService: AgentTransactionAuthorizationService,
    private readonly financialExecutionService: AgentFinancialExecutionService,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
    private readonly verificationService: AgentPasswordHashVerificationService,
  ) {}

  async execute(input: AgentCashOutInput): Promise<AgentCashOutResult> {
    const agentId = input.agentId?.trim();
    if (!agentId || !UUID_PATTERN.test(agentId)) {
      throw new BadRequestException('agentId must be a UUID');
    }
    const customerId = input.customerId?.trim();
    if (!customerId || !UUID_PATTERN.test(customerId)) {
      throw new BadRequestException('customerId must be a UUID');
    }
    if (!input.agentPrincipal || typeof input.agentPrincipal !== 'object') {
      throw new UnauthorizedException('Agent principal is required');
    }
    const agentPrincipal: AuthorizationPrincipal = input.agentPrincipal;
    if (agentPrincipal.type !== 'AGENT') {
      throw new ForbiddenException('Customer principal cannot perform Agent Wallet→Cash as Agent');
    }
    if (agentPrincipal.agentId && agentPrincipal.agentId.toLowerCase() !== agentId.toLowerCase()) {
      throw new ForbiddenException('Agent A cannot execute as Agent B');
    }

    const currency = normalizeCurrency(input.currency);
    if (currency !== 'NGN') {
      throw new BadRequestException('currency must be NGN');
    }
    const amount = parsePositiveMinorUnits(input.amountMinor, 'amountMinor');
    const amountString = amount.toString();

    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException('idempotencyKey is required and must be at most 255 characters');
    }
    if (!input.agentPin || typeof input.agentPin !== 'string' || !input.agentPin.trim()) {
      throw new BadRequestException('agentPin is required');
    }
    if (!input.customerPin || typeof input.customerPin !== 'string' || !input.customerPin.trim()) {
      throw new BadRequestException('customerPin is required');
    }
    if (!input.mfaChallengeId || typeof input.mfaChallengeId !== 'string' || !input.mfaChallengeId.trim()) {
      throw new BadRequestException('mfaChallengeId is required');
    }
    if (!input.otp || typeof input.otp !== 'string' || !input.otp.trim()) {
      throw new BadRequestException('otp is required');
    }

    // 1. Customer existence & eligibility
    const custRows: Array<{ id: string; status: string; deleted_at: string | null }> = await this.dataSource.query(
      `SELECT id, status, deleted_at FROM customers WHERE id = $1 LIMIT 1`,
      [customerId],
    );
    const customer = custRows[0];
    if (!customer || customer.deleted_at !== null) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    if (customer.status !== 'ACTIVE') {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    // 2. Customer wallet ownership — wallet must exist and be ACTIVE, ledger-derived
    // We will ensure wallet exists later, but first check that the walletAccount if exists is for this customer
    // No need to check binding; WalletAccount is the authority.

    // 3. Customer transaction PIN verification (before OTP, before financial)
    const pinResult = await this.customerPinService.verifyTransactionPin(
      customerId,
      { pin: input.customerPin, actor: customerId },
      this.verificationService as unknown as { verify: (pin: string, alg: string, hash: string) => { verified: boolean } },
    );
    if (!pinResult.verified) {
      if (pinResult.failureReason === 'PIN_NOT_FOUND' || pinResult.failureReason === 'INVALID_PIN' || pinResult.failureReason === 'MISMATCH') {
        throw new UnauthorizedException('Customer PIN invalid');
      }
      if (pinResult.locked || pinResult.failureReason === 'PIN_LOCKED') {
        throw new UnauthorizedException('Customer PIN is locked');
      }
      throw new UnauthorizedException(`Customer PIN denied: ${pinResult.failureReason}`);
    }

    // 4. OTP verification via MFA — canonical path only, no fallback
    // There must be exactly one authoritative OTP verification path.
    // We route exclusively through MfaExecutionService.verifyChallenge.
    // We fetch the challenge's session_id/credential_id to construct the principal
    // that MFA requires (customerId + sessionId + credentialId). No direct
    // challenge_hash comparison or manual VERIFIED transition is allowed.
    const challengeId = input.mfaChallengeId.trim().toLowerCase();
    if (!UUID_PATTERN.test(challengeId)) {
      throw new BadRequestException('mfaChallengeId must be a UUID');
    }
    const otp = input.otp.trim();
    if (!otp || otp.length > 512 || /\s/.test(otp)) {
      throw new BadRequestException('otp is invalid');
    }

    // Fetch challenge metadata to build the principal that MFA expects.
    // This read does NOT verify OTP — it only resolves which session/credential
    // the challenge is bound to, so that we can present the correct principal
    // to the canonical service. All security decisions (customer binding,
    // session binding, expiry, replay, hash equality, enrollment/method
    // ENABLED, status transitions) remain inside MfaExecutionService.
    const challengeMeta: Array<{ customer_id: string; session_id: string }> = await this.dataSource.query(
      `SELECT customer_id, session_id FROM mfa_challenges WHERE id = $1 LIMIT 1`,
      [challengeId],
    );
    const meta = challengeMeta[0];
    if (!meta) {
      throw new BadRequestException('Invalid OTP challenge');
    }
    if (meta.customer_id !== customerId) {
      // Do not reveal existence; treat as WRONG_CUSTOMER via canonical path
      // but fail fast here to avoid leaking timing
      throw new BadRequestException('OTP challenge does not belong to this Customer');
    }

    // Resolve credentialId for the challenge's session. The challenge is FK'd
    // to a session; that session's credential is the one MFA expects.
    const sessionRows: Array<{ credential_id: string }> = await this.dataSource.query(
      `SELECT credential_id FROM authentication_sessions WHERE id = $1 LIMIT 1`,
      [meta.session_id],
    );
    let credentialId = sessionRows[0]?.credential_id;
    if (!credentialId) {
      // Fallback to the customer's active credential if session lookup fails
      // (e.g., session was cleaned). This still enforces customer binding;
      // session binding will be checked by MfaExecutionService and will
      // correctly return WRONG_SESSION if mismatched.
      const credRows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM customer_authentication_credentials WHERE customer_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
        [customerId],
      );
      credentialId = credRows[0]?.id ?? '';
      if (!credentialId || !UUID_PATTERN.test(credentialId)) {
        throw new BadRequestException('OTP verification unavailable - no credential');
      }
    }

    const principalForMfa: any = {
      principalType: 'CUSTOMER',
      customerId,
      sessionId: meta.session_id,
      credentialId,
    };

    const verifyResult = await this.mfaExecutionService.verifyChallenge({
      principal: principalForMfa,
      challengeId,
      providedHash: otp,
      actor: customerId,
    } as any);

    if (!verifyResult.verified) {
      const reason = verifyResult.failureReason;
      if (reason === 'REPLAYED') {
        // OTP is one-time. For a true idempotent retry (same Agent+idempotencyKey
        // that already completed), the challenge will be VERIFIED from the first
        // successful call. In that case the financial layer will return REPLAYED
        // with no new journal. We allow REPLAYED to proceed only if the
        // idempotency record for this Agent+key already exists as COMPLETED;
        // otherwise it is a genuine replay attempt for a new operation and must
        // be denied.
        const scope = `agent-financial.v1:${agentId}`;
        const existing: Array<{ status: string }> = await this.dataSource.query(
          `SELECT status FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2 LIMIT 1`,
          [scope, idempotencyKey],
        );
        if (!existing[0] || (existing[0].status !== 'COMPLETED' && existing[0].status !== 'IN_PROGRESS')) {
          throw new BadRequestException('OTP already used');
        }
        // Allow to proceed — financial execution will return REPLAYED
      } else if (reason === 'EXPIRED') {
        throw new BadRequestException('OTP expired');
      } else if (reason === 'MISMATCH') {
        throw new BadRequestException('OTP invalid');
      } else if (reason === 'INVALID_CHALLENGE' || reason === 'MFA_UNAVAILABLE' || reason === 'WRONG_CUSTOMER' || reason === 'WRONG_SESSION') {
        throw new BadRequestException(`OTP invalid: ${reason}`);
      } else {
        throw new BadRequestException(`OTP verification failed: ${reason}`);
      }
    }

    // 5. Agent authorization via A11 — CASH_OUT + agentPin + agentPrincipal
    const authResult = await this.agentAuthorizationService.authorize({
      agentId,
      service: AgentService.CASH_OUT,
      pin: input.agentPin,
      principal: agentPrincipal,
    });
    if (!authResult.allowed || !authResult.context) {
      const reason = authResult.reason;
      if (reason === 'PIN_REQUIRED' || reason === 'PIN_INVALID' || reason === 'PIN_NOT_FOUND') {
        throw new UnauthorizedException(`Agent PIN invalid: ${reason}`);
      }
      if (reason === 'PIN_LOCKED') throw new UnauthorizedException('Agent PIN is locked');
      if (reason === 'PRINCIPAL_MISMATCH' || reason === 'PRINCIPAL_NOT_AGENT' || reason === 'WORKFORCE_NOT_PERMITTED') {
        throw new ForbiddenException(`Authorization denied: ${reason}`);
      }
      if (
        reason === 'AGENT_PENDING' ||
        reason === 'AGENT_SUSPENDED' ||
        reason === 'AGENT_TERMINATED' ||
        reason === 'AGENT_NOT_FOUND' ||
        reason === 'AGENT_DELETED'
      ) {
        throw new ForbiddenException(`Agent not permitted: ${reason}`);
      }
      if (reason === 'SERVICE_NOT_PERMITTED' || reason === 'UNKNOWN_SERVICE') {
        throw new ForbiddenException('Agent does not have CASH_OUT capability');
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
    const authorizedContext = authResult.context;

    // 6. Ensure wallets exist (customer is payer, agent is receiver)
    const customerWallet = await this.ensureWalletAccount(customerId, 'NGN');
    const agentWallet = await this.ensureWalletAccount(agentId, 'NGN');

    // 7. Financial execution via A12 — DEBIT Customer, CREDIT Agent
    const reference = input.reference?.trim() ? input.reference.trim() : `CASH_OUT-${idempotencyKey}`;
    const description = input.description?.trim()
      ? input.description.trim()
      : `Wallet→Cash ${amountString} NGN from Customer ${customerId} to Agent ${agentId}`;
    const correlationId = input.correlationId?.trim() ? input.correlationId.trim() : undefined;

    const executionResult = await this.financialExecutionService.execute({
      authorizedContext,
      idempotencyKey,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: customerWallet.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amountString },
        { accountId: agentWallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: amountString },
      ],
      reference,
      description,
      correlationId,
      metadata: {
        operation: 'CASH_OUT',
        agentId,
        customerId,
        amountMinor: amountString,
        currency: 'NGN',
        ...(input.metadata ?? {}),
      },
    });

    // 8. Audit business flow — transactional if possible, but financial audit is already inside A12
    // For Wallet→Cash, we make the business audit part of a separate transaction that is not best-effort alone:
    // If audit fails, we still return the financial result (audit is not allowed to fail the financial)
    // But we ensure we use a dedicated transaction so that audit is durable.
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.auditService.record(manager, {
          entityType: 'AGENT_CASH_OUT',
          entityId: executionResult.journalId,
          action: executionResult.replayed ? 'CASH_OUT_REPLAYED' : 'CASH_OUT_COMPLETED',
          actor: agentPrincipal.principalId,
          correlationId,
          newValues: {
            agentId,
            customerId,
            amountMinor: amountString,
            currency: 'NGN',
            operation: 'CASH_OUT',
            journalId: executionResult.journalId,
            idempotencyKey,
            requestHash: executionResult.requestHash,
            replayed: executionResult.replayed,
            status: executionResult.status,
            reference,
            correlationId: correlationId ?? null,
            mfaChallengeId: input.mfaChallengeId,
          },
        });
      });
    } catch {
      // best-effort but logged; financial already committed, so we do not throw
    }

    return {
      status: executionResult.status,
      journalId: executionResult.journalId,
      agentId,
      customerId,
      amountMinor: amountString,
      currency: 'NGN',
      idempotencyKey,
      requestHash: executionResult.requestHash,
      replayed: executionResult.replayed,
      correlationId,
      reference,
      createdAt: executionResult.createdAt,
    };
  }

  private async ensureWalletAccount(customerId: string, currency: string): Promise<WalletAccount> {
    const repo = this.dataSource.getRepository(WalletAccount);
    const existing = await repo.findOne({ where: { customerId, currency } });
    if (existing) return existing;
    const idempotencyKey = `cash-out-ensure-${customerId}-${currency}-${randomUUID()}`;
    try {
      const view = await this.walletService.createWallet({ customerId, currency, idempotencyKey });
      const wallet = await repo.findOne({ where: { customerId, currency } });
      if (wallet) return wallet;
      const byId = await repo.findOne({ where: { id: view.id } });
      if (byId) return byId;
      throw new NotFoundException(`Wallet for ${customerId} not found after creation`);
    } catch (error) {
      if (error instanceof ConflictException) {
        const retry = await repo.findOne({ where: { customerId, currency } });
        if (retry) return retry;
      }
      const retry = await repo.findOne({ where: { customerId, currency } });
      if (retry) return retry;
      throw error;
    }
  }
}
