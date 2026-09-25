/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { createHash, pbkdf2Sync, randomBytes, randomInt, randomUUID } from 'node:crypto';

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
import { IdempotencyService } from '../operations/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { parsePositiveMinorUnits, normalizeCurrency } from '../common/money';
import { isRetryableTransactionError, MAX_SERIALIZABLE_ATTEMPTS } from '../common/serializable-transaction';
import { AgentTransactionAuthorizationService } from './agent-transaction-authorization.service';
import { AgentReceivingNumberService } from './agent-receiving-number.service';
import { AgentService } from './agent-service.enum';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AgentCashToCashInput, AgentCashToCashResult } from './agent-cash-to-cash.types';
import { CashToCashTransfer } from './cash-to-cash.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_SCOPE_PREFIX = 'agent-financial.v1:';
const RETENTION_SECONDS = 86400;
const UNCLAIMED_CODE = 'CASH_TO_CASH-UNCLAIMED-NGN';
const TRANSFER_CODE_ITERATIONS = 10000;

@Injectable()
export class AgentCashToCashService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authorizationService: AgentTransactionAuthorizationService,
    private readonly ledgerService: LedgerService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
  ) {}

  async execute(input: AgentCashToCashInput): Promise<AgentCashToCashResult> {
    const agentId = input.agentId?.trim();
    if (!agentId || !UUID_PATTERN.test(agentId)) {
      throw new BadRequestException('agentId must be a UUID');
    }
    if (!input.agentPrincipal || typeof input.agentPrincipal !== 'object') {
      throw new UnauthorizedException('Agent principal is required');
    }
    const principal: AuthorizationPrincipal = input.agentPrincipal;
    if (principal.type !== 'AGENT') {
      throw new ForbiddenException('Customer principal cannot perform Agent Cash→Cash');
    }
    if (principal.agentId && principal.agentId.toLowerCase() !== agentId.toLowerCase()) {
      throw new ForbiddenException('Agent A cannot execute as Agent B');
    }

    const rawPhone = input.beneficiaryPhone?.trim();
    if (!rawPhone) {
      throw new BadRequestException('beneficiaryPhone is required');
    }
    const canonicalPhone = AgentReceivingNumberService.canonicalizeTo10(rawPhone);
    if (!canonicalPhone) {
      throw new BadRequestException('beneficiaryPhone must be a valid Nigerian 10-digit number');
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

    const pin = input.agentPin;
    if (!pin || typeof pin !== 'string' || !pin.trim()) {
      throw new BadRequestException('agentPin is required');
    }

    // Fee handling: V1 has no configurable fee for Cash→Cash yet.
    // We keep fee/vat at 0 and document assumption. If fee infrastructure
    // becomes applicable, this service should be extended to compute via FeeEngine
    // and add additional ledger lines (fee, vat) before principal.
    const feeMinor = 0n;
    const vatMinor = 0n;
    const totalMinor = amount + feeMinor + vatMinor;
    const totalString = totalMinor.toString();

    // 1. Authorization via A11 — CASH_TO_CASH + PIN + principal (fail-closed)
    const authResult = await this.authorizationService.authorize({
      agentId,
      service: AgentService.CASH_TO_CASH,
      pin,
      principal,
    });
    if (!authResult.allowed || !authResult.context) {
      const reason = authResult.reason;
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
        throw new ForbiddenException('Agent does not have CASH_TO_CASH capability');
      }
      if (reason === 'AGENT_CLASS_INACTIVE' || reason === 'MISSING_AGENT_CLASS' || reason === 'AGENT_CLASS_NOT_FOUND' || reason === 'AGENT_CLASS_DELETED') {
        throw new ForbiddenException(`Agent class invalid: ${reason}`);
      }
      throw new ForbiddenException(`Authorization denied: ${reason}`);
    }
    // authResult.context is validated above; principal is already verified for downstream audit/ledger

    // 2. Ensure Agent wallet exists (for balance check)
    // We do not create beneficiary Customer wallet — beneficiary is unregistered.
    // Also ensure beneficiary phone is not an active Agent receiving number (no Agent recipient)
    const agentReceivingCheck: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM agent_receiving_numbers WHERE receiving_number = $1 AND status = 'ACTIVE' LIMIT 1`,
      [canonicalPhone],
    );
    if (agentReceivingCheck.length > 0) {
      throw new BadRequestException('Recipient must not be an Agent; Agent recipient is not allowed');
    }

    // Ensure wallets (outside SERIALIZABLE, as creation is idempotent via WalletService)
    // But for ledger lock we need wallet account ids, so fetch or create.
    // We will do wallet ensure inside transaction as well for atomicity, but we can prefetch.

    // Compute reference/description/correlation
    const reference = input.reference?.trim() ? input.reference.trim() : `CASH_TO_CASH-${idempotencyKey}`;
    const description = input.description?.trim()
      ? input.description.trim()
      : `Cash→Cash ${amountString} NGN from Agent ${agentId} to ${canonicalPhone}`;
    const correlationId = input.correlationId?.trim() ? input.correlationId.trim() : undefined;

    // For ledger post, we need unclaimed account id. Fetch outside transaction or inside.
    const unclaimedAccount = await this.getUnclaimedAccount();
    if (!unclaimedAccount) {
      throw new BadRequestException('Unclaimed ledger account not provisioned');
    }

    const agentWallet = await this.ensureWalletAccount(agentId, 'NGN');

    // Build lines: DEBIT Agent, CREDIT Unclaimed (principal)
    // If fee >0, would add fee lines: DEBIT Agent for total, CREDIT Unclaimed for principal, CREDIT fee account for fee+vat
    const lines = [
      {
        accountId: agentWallet.ledgerAccountId,
        direction: LedgerEntryDirection.DEBIT as const,
        amountMinor: totalString,
      },
      {
        accountId: unclaimedAccount.id,
        direction: LedgerEntryDirection.CREDIT as const,
        amountMinor: amountString,
      },
    ];
    // If fee present, add fee lines (not in V1)
    if (feeMinor > 0n || vatMinor > 0n) {
      // For now, not applicable — document blocker
      // Would need fee control account provisioned; not inventing parallel fee system per STOP condition
    }

    const requestHash = this.computeRequestHash({
      agentId,
      beneficiaryPhone: canonicalPhone,
      principalMinor: amountString,
      feeMinor: feeMinor.toString(),
      vatMinor: vatMinor.toString(),
      totalMinor: totalString,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines,
      reference,
      description,
      correlationId: correlationId ?? null,
      metadata: input.metadata ?? {},
    });

    const scope = `${IDEMPOTENCY_SCOPE_PREFIX}${agentId}`;

    for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const reservation = await this.idempotencyService.reserve(manager, {
            scope,
            key: idempotencyKey,
            requestHash,
            retentionSeconds: RETENTION_SECONDS,
          });

          if (reservation.kind === 'REPLAY') {
            const existing = reservation.record;
            const body = existing.responseBody as unknown as AgentCashToCashResult | null;
            // If we have stored body with transferId/journalId, return it as REPLAYED
            if (body && (body as unknown as { transferId?: string }).transferId) {
              return { ...body, status: 'REPLAYED' as const, replayed: true, transferCode: undefined } as AgentCashToCashResult;
            }
            if (existing.resourceId) {
              // Try to fetch transfer by journalId
              const transfer = (
                await manager.query(`SELECT * FROM cash_to_cash_transfers WHERE journal_id = $1 LIMIT 1`, [existing.resourceId])
              )[0] as CashToCashTransfer | undefined;
              if (transfer) {
                const typed = transfer as unknown as {
                  id: string;
                  beneficiary_phone: string;
                  principal_minor: string;
                  fee_minor: string;
                  vat_minor: string;
                  total_minor: string;
                  currency: string;
                  reference: string | null;
                  correlation_id: string | null;
                };
                return {
                  status: 'REPLAYED',
                  transferId: typed.id,
                  journalId: existing.resourceId,
                  agentId,
                  beneficiaryPhone: typed.beneficiary_phone,
                  principalMinor: typed.principal_minor,
                  feeMinor: typed.fee_minor,
                  vatMinor: typed.vat_minor,
                  totalMinor: typed.total_minor,
                  currency: typed.currency,
                  amountMinor: typed.principal_minor,
                  idempotencyKey,
                  requestHash,
                  replayed: true,
                  correlationId: typed.correlation_id ?? correlationId,
                  reference: typed.reference ?? reference,
                  createdAt: existing.updatedAt,
                };
              }
              // Fallback to idempotency replay without transfer lookup
              return {
                status: 'REPLAYED',
                transferId: existing.resourceId,
                journalId: existing.resourceId,
                agentId,
                beneficiaryPhone: canonicalPhone,
                principalMinor: amountString,
                feeMinor: feeMinor.toString(),
                vatMinor: vatMinor.toString(),
                totalMinor: totalString,
                currency: 'NGN',
                amountMinor: amountString,
                idempotencyKey,
                requestHash,
                replayed: true,
                correlationId,
                reference,
                createdAt: existing.updatedAt,
              };
            }
            throw new ConflictException('Idempotency replay missing resource linkage');
          }

          // NEW — verify Agent wallet ownership inside same transaction (pessimistic)
          const walletInTx = await manager.getRepository(WalletAccount).findOne({
            where: { customerId: agentId, currency: 'NGN' },
          });
          if (!walletInTx) {
            throw new NotFoundException(`Agent wallet for ${agentId} not found`);
          }
          const involved = lines.some((l) => l.accountId === walletInTx.ledgerAccountId);
          if (!involved) {
            throw new BadRequestException('Agent financial execution must involve the Agent wallet ledger account');
          }

          // Lock unclaimed account as well (via ledger lines lock)
          // Generate transfer code (8-digit numeric) and hash
          // Assumption: No approved format exists; using 8-digit numeric (10000000-99999999) with PBKDF2.
          // This is not presented as regulatory requirement; documented as implementation assumption.
          const transferCode = this.generateTransferCode();
          const { hash: transferCodeHash, algorithm } = this.hashTransferCode(transferCode);

          // Post journal via ledger (inside same transaction)
          const ledgerIdempotencyKey = `agent:${agentId}:${idempotencyKey}`;
          const journalId = await this.ledgerService.postJournalInTransaction(manager, {
            idempotencyKey: ledgerIdempotencyKey,
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            reference,
            description,
            correlationId,
            metadata: {
              ...(input.metadata ?? {}),
              operation: 'CASH_TO_CASH',
              agentId,
              beneficiaryPhone: canonicalPhone,
              principalMinor: amountString,
              feeMinor: feeMinor.toString(),
              vatMinor: vatMinor.toString(),
              totalMinor: totalString,
              currency: 'NGN',
              idempotencyKey,
              requestHash,
            },
            lines: lines.map((l) => ({
              accountId: l.accountId,
              direction: l.direction as LedgerEntryDirection,
              amountMinor: l.amountMinor,
            })),
          });

          // Create cash_to_cash_transfers record atomically with journal
          const idForTransfer = randomUUID();
          await manager.query(
            `INSERT INTO cash_to_cash_transfers (
              id, agent_id, beneficiary_phone, principal_minor, fee_minor, vat_minor, total_minor, currency, status,
              transfer_code_hash, hash_algorithm, transfer_code_version, failed_attempts, is_locked, journal_id, reference, idempotency_key, correlation_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, 'UNCLAIMED', $9, $10, 1, 0, FALSE, $11, $12, $13, $14
            )`,
            [
              idForTransfer,
              agentId,
              canonicalPhone,
              amountString,
              feeMinor.toString(),
              vatMinor.toString(),
              totalString,
              'NGN',
              transferCodeHash,
              algorithm,
              journalId,
              reference,
              idempotencyKey,
              correlationId ?? null,
            ],
          );

          const result: AgentCashToCashResult = {
            status: 'COMPLETED',
            transferId: idForTransfer,
            journalId,
            agentId,
            beneficiaryPhone: canonicalPhone,
            principalMinor: amountString,
            feeMinor: feeMinor.toString(),
            vatMinor: vatMinor.toString(),
            totalMinor: totalString,
            currency: 'NGN',
            amountMinor: amountString,
            idempotencyKey,
            requestHash,
            replayed: false,
            correlationId,
            reference,
            createdAt: new Date(),
            transferCode,
          };

          // Complete idempotency — store result WITHOUT transferCode plaintext
          // We redact transferCode before persisting to avoid plaintext leak via idempotency_records
          const redactedForIdempotency = { ...result, transferCode: undefined };
          await this.idempotencyService.complete(manager, reservation.record.id, {
            statusCode: 201,
            responseBody: redactedForIdempotency as unknown as Record<string, unknown>,
            resourceType: 'CASH_TO_CASH_TRANSFER',
            resourceId: journalId,
          });

          await this.auditService.record(manager, {
            entityType: 'AGENT_CASH_TO_CASH',
            entityId: journalId,
            action: 'CASH_TO_CASH_INITIATED',
            actor: principal.principalId,
            correlationId,
            newValues: {
              transferId: idForTransfer,
              agentId,
              beneficiaryPhone: canonicalPhone,
              principalMinor: amountString,
              feeMinor: feeMinor.toString(),
              vatMinor: vatMinor.toString(),
              totalMinor: totalString,
              currency: 'NGN',
              journalId,
              idempotencyKey,
              requestHash,
              reference,
              correlationId: correlationId ?? null,
              status: 'UNCLAIMED',
            },
          });

          return result;
        });
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Cash→Cash could not complete after concurrent retries');
  }

  private generateTransferCode(): string {
    // 8-digit numeric, first digit 1-9 to avoid leading zero
    const code = randomInt(10000000, 100000000);
    return code.toString();
  }

  private hashTransferCode(code: string): { hash: string; algorithm: string } {
    const salt = randomBytes(16);
    const iterations = TRANSFER_CODE_ITERATIONS;
    const derived = pbkdf2Sync(code, salt, iterations, 32, 'sha256');
    const hash = `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
    return { hash, algorithm: 'PBKDF2' };
  }

  private async getUnclaimedAccount(): Promise<LedgerAccount | null> {
    return this.dataSource.getRepository(LedgerAccount).findOne({
      where: { code: UNCLAIMED_CODE },
    });
  }

  private async ensureWalletAccount(customerId: string, currency: string): Promise<WalletAccount> {
    const repo = this.dataSource.getRepository(WalletAccount);
    const existing = await repo.findOne({ where: { customerId, currency } });
    if (existing) return existing;
    throw new NotFoundException(`Wallet for ${customerId} not found`);
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
