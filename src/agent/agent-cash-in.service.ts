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
import { RecipientResolutionService } from './recipient-resolution.service';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentFinancialExecutionService } from './agent-financial-execution.service';
import { AgentService } from './agent-service.enum';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AgentCashInInput, AgentCashInResult } from './agent-cash-in.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AgentCashInService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly recipientResolutionService: RecipientResolutionService,
    private readonly authorizationService: AgentTransactionAuthorizationService,
    private readonly financialExecutionService: AgentFinancialExecutionService,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
  ) {}

  async execute(input: AgentCashInInput): Promise<AgentCashInResult> {
    const agentId = input.agentId?.trim();
    if (!agentId || !UUID_PATTERN.test(agentId)) {
      throw new BadRequestException('agentId must be a UUID');
    }
    if (!input.principal || typeof input.principal !== 'object') {
      throw new UnauthorizedException('Agent principal is required');
    }
    const principal: AuthorizationPrincipal = input.principal;
    // Principal checks are delegated to A11, but fail fast for obviously wrong principals to avoid leaking
    if (principal.type !== 'AGENT') {
      throw new ForbiddenException('Customer principal cannot perform Agent Cash→Wallet');
    }
    if (principal.agentId && principal.agentId.toLowerCase() !== agentId.toLowerCase()) {
      throw new ForbiddenException('Agent A cannot execute as Agent B');
    }

    const recipientIdentifier = input.recipientIdentifier?.trim();
    if (!recipientIdentifier) {
      throw new BadRequestException('recipientIdentifier is required');
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

    const pin = input.pin;
    if (!pin || typeof pin !== 'string' || !pin.trim()) {
      throw new BadRequestException('pin is required');
    }

    // 1. Recipient resolution — must be CUSTOMER
    const resolution = await this.recipientResolutionService.resolve(recipientIdentifier);

    if (resolution.ownerType !== 'CUSTOMER') {
      throw new BadRequestException('Recipient must be a Customer; Agent recipient is not allowed');
    }
    const customerId = resolution.ownerId;
    if (!UUID_PATTERN.test(customerId)) {
      throw new BadRequestException('Resolved customerId must be a UUID');
    }

    // 2. Customer eligibility — ACTIVE and not deleted
    const custRows: Array<{ id: string; status: string; deleted_at: string | null }> =
      await this.dataSource.query(`SELECT id, status, deleted_at FROM customers WHERE id = $1 LIMIT 1`, [
        customerId,
      ]);
    const customer = custRows[0];
    if (!customer || customer.deleted_at !== null) {
      throw new NotFoundException(`Recipient ${resolution.receivingNumber} not found`);
    }
    if (customer.status !== 'ACTIVE') {
      // CLOSED, SUSPENDED, DRAFT etc. → ineligible
      throw new NotFoundException(`Recipient ${resolution.receivingNumber} not found`);
    }

    // 3. Authorization via A11 — CASH_IN + PIN + principal
    const authResult = await this.authorizationService.authorize({
      agentId,
      service: AgentService.CASH_IN,
      pin,
      principal,
    });
    if (!authResult.allowed || !authResult.context) {
      const reason = authResult.reason;
      // Map to appropriate HTTP
      if (reason === 'PIN_REQUIRED' || reason === 'PIN_INVALID' || reason === 'PIN_NOT_FOUND') {
        throw new UnauthorizedException(`Transaction PIN invalid: ${reason}`);
      }
      if (reason === 'PIN_LOCKED') {
        throw new UnauthorizedException('Transaction PIN is locked');
      }
      if (reason === 'PRINCIPAL_MISMATCH' || reason === 'PRINCIPAL_NOT_AGENT' || reason === 'WORKFORCE_NOT_PERMITTED') {
        throw new ForbiddenException(`Authorization denied: ${reason}`);
      }
      if (reason === 'AGENT_PENDING' || reason === 'AGENT_SUSPENDED' || reason === 'AGENT_TERMINATED' || reason === 'AGENT_NOT_FOUND' || reason === 'AGENT_DELETED') {
        throw new ForbiddenException(`Agent not permitted: ${reason}`);
      }
      if (reason === 'SERVICE_NOT_PERMITTED' || reason === 'UNKNOWN_SERVICE') {
        throw new ForbiddenException('Agent does not have CASH_IN capability');
      }
      if (reason === 'AGENT_CLASS_INACTIVE' || reason === 'MISSING_AGENT_CLASS' || reason === 'AGENT_CLASS_NOT_FOUND' || reason === 'AGENT_CLASS_DELETED') {
        throw new ForbiddenException(`Agent class invalid: ${reason}`);
      }
      throw new ForbiddenException(`Authorization denied: ${reason}`);
    }
    const authorizedContext = authResult.context;

    // 4. Ensure wallets exist (idempotent, handle concurrent creation)
    const agentWallet = await this.ensureWalletAccount(agentId, 'NGN');
    const customerWallet = await this.ensureWalletAccount(customerId, 'NGN');

    // 5. Financial execution via A12 — DEBIT Agent, CREDIT Customer
    // Reference must be deterministic for idempotency: use caller-provided reference or derive from idempotencyKey
    const reference = input.reference?.trim() ? input.reference.trim() : `CASH_IN-${idempotencyKey}`;
    const description = input.description?.trim()
      ? input.description.trim()
      : `Cash→Wallet ${amountString} NGN from Agent ${agentId} to Customer ${customerId}`;
    const correlationId = input.correlationId?.trim() ? input.correlationId.trim() : undefined;

    const executionResult = await this.financialExecutionService.execute({
      authorizedContext,
      idempotencyKey,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: agentWallet.ledgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: amountString,
        },
        {
          accountId: customerWallet.ledgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: amountString,
        },
      ],
      reference,
      description,
      correlationId,
      metadata: {
        operation: 'CASH_IN',
        agentId,
        recipientCustomerId: customerId,
        recipientIdentifier,
        recipientReceivingNumber: resolution.receivingNumber,
        amountMinor: amountString,
        currency: 'NGN',
        ...(input.metadata ?? {}),
      },
    });

    // 6. Audit business flow (separate transaction, best-effort, never with PIN)
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.auditService.record(manager, {
          entityType: 'AGENT_CASH_IN',
          entityId: executionResult.journalId,
          action: executionResult.replayed ? 'CASH_IN_REPLAYED' : 'CASH_IN_COMPLETED',
          actor: principal.principalId,
          correlationId,
          newValues: {
            agentId,
            recipientCustomerId: customerId,
            recipientIdentifier,
            recipientReceivingNumber: resolution.receivingNumber,
            amountMinor: amountString,
            currency: 'NGN',
            operation: 'CASH_IN',
            journalId: executionResult.journalId,
            idempotencyKey,
            requestHash: executionResult.requestHash,
            replayed: executionResult.replayed,
            status: executionResult.status,
            reference,
            correlationId: correlationId ?? null,
          },
        });
      });
    } catch {
      // best-effort, do not fail transaction if audit fails
    }

    return {
      status: executionResult.status,
      journalId: executionResult.journalId,
      agentId,
      recipientCustomerId: customerId,
      recipientReceivingNumber: resolution.receivingNumber,
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

    // Try to create via WalletService (idempotent)
    const idempotencyKey = `cash-in-ensure-${customerId}-${currency}-${randomUUID()}`;
    try {
      const view = await this.walletService.createWallet({
        customerId,
        currency,
        idempotencyKey,
      });
      const wallet = await repo.findOne({ where: { customerId, currency } });
      if (wallet) return wallet;
      // Fallback: fetch by view id
      const byId = await repo.findOne({ where: { id: view.id } });
      if (byId) return byId;
      throw new NotFoundException(`Wallet for ${customerId} not found after creation`);
    } catch (error) {
      if (error instanceof ConflictException) {
        // Check if it's customer_currency conflict or idempotency conflict
        const msg = (error as Error).message.toLowerCase();
        if (msg.includes('already exists') || msg.includes('already used')) {
          const retry = await repo.findOne({ where: { customerId, currency } });
          if (retry) return retry;
        }
      }
      // If createWallet threw due to duplicate, try again to fetch
      const retry = await repo.findOne({ where: { customerId, currency } });
      if (retry) return retry;
      throw error;
    }
  }
}
