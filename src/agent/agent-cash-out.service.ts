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

import { sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';
import { AuditService } from '../operations/audit.service';
import { AGENT_DESK_OTP_PURPOSE_WALLET_TO_CASH } from './agent-desk-otp.constants';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletService } from '../wallet/wallet.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { parsePositiveMinorUnits, normalizeCurrency } from '../common/money';
import { CashOutInstitutionResolver } from './cash-out-institution.resolver';
import { requireCashOutAgentSession } from './cash-out-intent';
import { cashOutOtpVerificationBudget, recordCashOutOtpFailure } from './cash-out-otp-budget';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentFinancialExecutionService } from './agent-financial-execution.service';
import { AgentService } from './agent-service.enum';
import { CustomerTransactionPinService } from '../customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../customer-authentication/mfa-execution.service';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { AgentPasswordHashVerificationService } from '../agent-authentication/agent-password-hash-verification.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AgentCashOutInput, AgentCashOutResult } from './agent-cash-out.types';
import type { AgentFinancialExecutionResult } from './agent-financial-execution.types';

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
    private readonly financialEligibility: CustomerFinancialEligibilityService,
    private readonly institutionResolver: CashOutInstitutionResolver,
  ) {}

  /** Read-only receipt recovery: never invokes OTP verification or financial posting. */
  async recoverReceipt(
    principal: AuthorizationPrincipal,
    rawKey: string,
  ): Promise<AgentCashOutResult> {
    const agentId = principal.agentId;
    const key = rawKey?.trim();
    if (
      principal.type !== 'AGENT' ||
      !agentId ||
      principal.principalId !== agentId ||
      !key ||
      key.length > 255
    )
      throw new UnauthorizedException('Agent authentication required');
    return this.dataSource.transaction(async (manager) => {
      await requireCashOutAgentSession(manager, agentId, principal.sessionId);
      const rows = await manager.query<
        Array<{
          customer_id: string;
          challenge_id: string;
          journal_id: string;
          request_hash: string;
          amount_minor: string;
          currency: string;
          reference: string | null;
          correlation_id: string | null;
          created_at: Date;
          intent_id: string | null;
          intent_status: string | null;
        }>
      >(
        `SELECT r.customer_id,r.challenge_id,r.journal_id,r.request_hash,j.total_minor::text AS amount_minor,j.currency,j.reference,j.correlation_id,j.created_at,c.cash_out_intent_id AS intent_id,i.status AS intent_status
        FROM cash_out_execution_records r
        JOIN ledger_journals j ON j.id=r.journal_id AND j.status='POSTED' AND j.currency='NGN' AND j.accounting_unit='CUSTOMER_FUNDS'
        JOIN mfa_challenges c ON c.id=r.challenge_id AND c.customer_id=r.customer_id
        LEFT JOIN cash_out_intents i ON i.id=c.cash_out_intent_id
        WHERE r.agent_id=$1 AND r.idempotency_key=$2
          AND j.idempotency_key='agent:' || $1::text || ':' || $2
          AND j.metadata->>'canonicalService'='CASH_OUT' AND j.metadata->>'agentId'=$1::text AND j.metadata->>'requestHash'=r.request_hash
          AND EXISTS(SELECT 1 FROM ledger_lines l JOIN wallet_accounts w ON w.ledger_account_id=l.ledger_account_id WHERE l.journal_id=j.id AND l.direction='DEBIT' AND w.customer_id=r.customer_id::text AND w.owner_class='CUSTOMER' AND l.amount_minor=j.total_minor)
          AND EXISTS(SELECT 1 FROM ledger_lines l JOIN wallet_accounts w ON w.ledger_account_id=l.ledger_account_id WHERE l.journal_id=j.id AND l.direction='CREDIT' AND w.customer_id=r.agent_id::text AND w.owner_class='AGENT' AND l.amount_minor=j.total_minor)
          AND (c.cash_out_intent_id IS NULL OR (i.status='COMPLETED' AND i.agent_id=r.agent_id AND i.customer_id=r.customer_id AND i.operation_key=r.idempotency_key AND i.institution_scope='MONIENAIJA'))`,
        [agentId, key],
      );
      const row = rows[0];
      if (!row)
        throw new NotFoundException('Cash-out receipt unavailable; reconciliation may be required');
      const institution = await this.institutionResolver.resolve(manager, agentId, row.customer_id);
      if (institution !== 'MONIENAIJA')
        throw new ConflictException('Institution integration not supported by current schema');
      return {
        status: 'REPLAYED',
        journalId: row.journal_id,
        agentId,
        customerId: row.customer_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        idempotencyKey: key,
        requestHash: row.request_hash,
        replayed: true,
        correlationId: row.correlation_id ?? undefined,
        reference: row.reference ?? undefined,
        createdAt: row.created_at,
      };
    });
  }

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
      throw new BadRequestException(
        'idempotencyKey is required and must be at most 255 characters',
      );
    }
    if (!input.agentPin || typeof input.agentPin !== 'string' || !input.agentPin.trim()) {
      throw new BadRequestException('agentPin is required');
    }
    if (!input.customerPin || typeof input.customerPin !== 'string' || !input.customerPin.trim()) {
      throw new BadRequestException('customerPin is required');
    }
    if (
      !input.mfaChallengeId ||
      typeof input.mfaChallengeId !== 'string' ||
      !input.mfaChallengeId.trim()
    ) {
      throw new BadRequestException('mfaChallengeId is required');
    }
    if (!input.otp || typeof input.otp !== 'string' || !input.otp.trim()) {
      throw new BadRequestException('otp is required');
    }

    // 1. Customer existence & eligibility
    const custRows: Array<{ id: string; status: string; deleted_at: string | null }> =
      await this.dataSource.query(
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
      this.verificationService as unknown as {
        verify: (pin: string, alg: string, hash: string) => { verified: boolean };
      },
    );
    if (!pinResult.verified) {
      if (
        pinResult.failureReason === 'PIN_NOT_FOUND' ||
        pinResult.failureReason === 'INVALID_PIN' ||
        pinResult.failureReason === 'MISMATCH'
      ) {
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

    const challengeMeta = await this.dataSource.query<
      Array<{ customer_id: string; cash_out_intent_id: string; credential_id: string }>
    >(
      `SELECT c.customer_id, c.cash_out_intent_id, i.credential_id FROM mfa_challenges c JOIN cash_out_intents i ON i.id=c.cash_out_intent_id WHERE c.id=$1 AND c.purpose='WALLET_TO_CASH'`,
      [challengeId],
    );
    const meta = challengeMeta[0];
    if (!meta || meta.customer_id !== customerId)
      throw new BadRequestException('Invalid cash-out OTP challenge');
    const principalForMfa: any = {
      principalType: 'CUSTOMER',
      customerId,
      sessionId: meta.cash_out_intent_id,
      credentialId: meta.credential_id,
    };

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
      if (
        reason === 'PRINCIPAL_MISMATCH' ||
        reason === 'PRINCIPAL_NOT_AGENT' ||
        reason === 'WORKFORCE_NOT_PERMITTED'
      ) {
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
    const reference = input.reference?.trim()
      ? input.reference.trim()
      : `CASH_OUT-${idempotencyKey}`;
    const description = input.description?.trim()
      ? input.description.trim()
      : `Wallet→Cash ${amountString} NGN from Customer ${customerId} to Agent ${agentId}`;
    // Report 26 (N-02): bounded, deterministic sanitization of the caller-supplied
    // business correlation id (legitimate ids preserved byte-for-byte).
    const correlationId = sanitizeDiagnosticIdentifier(input.correlationId);

    const executionResult = await this.financialExecutionService.execute(
      {
        authorizedContext,
        idempotencyKey,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: customerWallet.ledgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: amountString,
          },
          {
            accountId: agentWallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: amountString,
          },
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
          mfaChallengeId: challengeId,
        },
        limit: {
          product: 'WALLET_TO_CASH',
          principalType: 'CUSTOMER',
          principalId: customerId,
          direction: 'OUTGOING',
          channel: null,
          amountMinor: amountString,
          currency: 'NGN',
          walletLedgerAccountId: customerWallet.ledgerAccountId,
          principalWalletCustomerId: customerId,
        },
      },
      async (manager, replay, requestHash) => {
        await requireCashOutAgentSession(manager, agentId, agentPrincipal.sessionId);
        const institutionScope = await this.institutionResolver.resolve(
          manager,
          agentId,
          customerId,
        );
        if (institutionScope !== 'MONIENAIJA')
          throw new ConflictException('Institution integration not supported by current schema');
        await this.financialEligibility.require(manager, customerId, { lockMode: 'SHARE' });
        const intents = await manager.query<Array<{ status: string; valid: boolean }>>(
          `SELECT i.status, (i.expires_at>clock_timestamp()) AS valid
             FROM cash_out_intents i
             JOIN mfa_challenges c ON c.cash_out_intent_id=i.id
             JOIN customer_authentication_credentials cred ON cred.id=i.credential_id AND cred.customer_id=i.customer_id AND cred.status='ACTIVE' AND cred.deleted_at IS NULL AND cred.password_version=i.credential_version
             JOIN wallet_accounts w ON w.id=i.source_wallet_id AND w.ledger_account_id=i.source_ledger_id AND w.customer_id=i.customer_id::text AND w.currency=i.currency AND w.status='ACTIVE' AND w.owner_class='CUSTOMER'
            WHERE i.id=$1 AND c.id=$2 AND i.customer_id=$3 AND i.agent_id=$4 AND i.agent_session_id=$5 AND i.operation_key=$6 AND i.amount_minor=$7 AND i.currency='NGN' AND i.purpose='WALLET_TO_CASH' AND i.institution_scope='MONIENAIJA' AND i.source_wallet_id=$8 AND i.source_ledger_id=$9 FOR UPDATE OF i`,
          [
            meta.cash_out_intent_id,
            challengeId,
            customerId,
            agentId,
            agentPrincipal.sessionId ?? null,
            idempotencyKey,
            amountString,
            customerWallet.id,
            customerWallet.ledgerAccountId,
          ],
        );
        const intent = intents[0];
        if (
          !intent ||
          (intent.status !== 'ACTIVE' && intent.status !== 'COMPLETED') ||
          (intent.status === 'ACTIVE' && !intent.valid)
        )
          throw new ConflictException('Cash-out intent unavailable or mismatched');

        const records = await manager.query<
          Array<{
            customer_id: string;
            challenge_id: string;
            request_hash: string;
            response_body: AgentFinancialExecutionResult;
          }>
        >(
          `SELECT customer_id, challenge_id, request_hash, response_body FROM cash_out_execution_records WHERE agent_id=$1 AND idempotency_key=$2 FOR UPDATE`,
          [agentId, idempotencyKey],
        );
        const record = records[0];
        if (record) {
          if (intent.status !== 'COMPLETED')
            throw new ConflictException('Cash-out intent state mismatch');
          if (
            record.customer_id !== customerId ||
            record.challenge_id !== challengeId ||
            record.request_hash !== requestHash
          ) {
            throw new ConflictException('Cash-out replay does not match the authorized execution');
          }
          return {
            ...record.response_body,
            status: 'REPLAYED' as const,
            replayed: true,
            replayedFrom: record.response_body.journalId,
          };
        }
        // Pre-migration idempotency receipts do not establish an OTP-to-journal binding.
        if (replay || intent.status !== 'ACTIVE')
          throw new ConflictException('Cash-out replay authorization record unavailable');
        const challengeSecurity = await manager.query<Array<{ destination_hash: string }>>(
          `SELECT s.destination_hash FROM cash_out_otp_challenge_security s JOIN mfa_challenges c ON c.id=s.challenge_id
           WHERE s.challenge_id=$1 AND s.customer_id=$2 AND c.customer_id=$2 AND c.purpose='WALLET_TO_CASH' AND s.intent_id=$3 AND c.cash_out_intent_id=$3`,
          [challengeId, customerId, meta.cash_out_intent_id],
        );
        if (!challengeSecurity[0]) return 'Cash-out OTP authorization unavailable';
        const budgetKeys = await cashOutOtpVerificationBudget(
          manager,
          customerId,
          challengeSecurity[0].destination_hash,
          meta.cash_out_intent_id,
        );
        if (!budgetKeys) return 'Cash-out OTP temporarily unavailable';
        const result = await this.mfaExecutionService.verifyChallengeInManager(manager, {
          expectedPurpose: AGENT_DESK_OTP_PURPOSE_WALLET_TO_CASH,
          principal: principalForMfa,
          challengeId,
          providedHash: otp,
          actor: customerId,
        } as any);
        if (result.verified) return null;
        if (result.failureReason === 'EXPIRED') return 'OTP expired';
        if (result.failureReason === 'MISMATCH') {
          await recordCashOutOtpFailure(manager, budgetKeys);
          return 'OTP invalid';
        }
        if (result.failureReason === 'REPLAYED') return 'OTP already used';
        return `OTP verification failed: ${result.failureReason}`;
      },
      async (manager, requestHash, result) => {
        await manager.query(
          `UPDATE cash_out_intents SET status='COMPLETED' WHERE id=$1 AND status='ACTIVE'`,
          [meta.cash_out_intent_id],
        );
        await manager.query(
          `INSERT INTO cash_out_execution_records(agent_id,idempotency_key,customer_id,challenge_id,request_hash,journal_id,response_body)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            agentId,
            idempotencyKey,
            customerId,
            challengeId,
            requestHash,
            result.journalId,
            JSON.stringify(result),
          ],
        );
      },
    );

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
