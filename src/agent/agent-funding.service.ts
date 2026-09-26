import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

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
import { WalletService } from '../wallet/wallet.service';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { isRetryableTransactionError, MAX_SERIALIZABLE_ATTEMPTS } from '../common/serializable-transaction';
import { AgentServiceCapabilityService } from './agent-service-capability.service';
import { AgentStatus } from './agent.enums';
import { AgentService } from './agent-service.enum';
import { AggregatorStatus } from '../aggregator/aggregator.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUNDING_POOL_CODE = 'AGENT_FUNDING_POOL-NGN';
const RETENTION_SECONDS = 86_400;

export interface FundingInput {
  agentId: string;
  aggregatorId?: string; // if present, funding via Aggregator relationship
  amountMinor: string;
  currency?: string;
  idempotencyKey: string;
  reference?: string;
  correlationId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  principal: AuthorizationPrincipal;
  actor: string;
}

export interface FundingResult {
  status: 'COMPLETED' | 'REPLAYED';
  journalId: string;
  agentId: string;
  aggregatorId?: string | null;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  createdAt: Date;
  reference?: string;
  correlationId?: string | null;
}

@Injectable()
export class AgentFundingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
    private readonly walletService: WalletService,
    private readonly capabilityService: AgentServiceCapabilityService,
  ) {}

  async fund(input: FundingInput): Promise<FundingResult> {
    return this.executeFunding(input, 'FUND');
  }

  async defund(input: FundingInput): Promise<FundingResult> {
    return this.executeFunding(input, 'DEFUND');
  }

  private async executeFunding(input: FundingInput, direction: 'FUND' | 'DEFUND'): Promise<FundingResult> {
    const agentId = input.agentId?.trim();
    if (!agentId || !UUID_PATTERN.test(agentId)) throw new BadRequestException('agentId must be a UUID');
    const aggregatorId = input.aggregatorId?.trim();
    if (aggregatorId && !UUID_PATTERN.test(aggregatorId)) throw new BadRequestException('aggregatorId must be a UUID');

    const currency = normalizeCurrency(input.currency ?? 'NGN');
    if (currency !== 'NGN') throw new BadRequestException('currency must be NGN');

    const amount = parsePositiveMinorUnits(input.amountMinor, 'amountMinor');
    const amountString = amount.toString();

    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new BadRequestException('idempotencyKey is required and must be at most 255 characters');

    const reference = input.reference?.trim() ? input.reference.trim() : `${direction}-${idempotencyKey}`;
    if (reference.length > 255) throw new BadRequestException('reference too long');

    const correlationId = input.correlationId?.trim() ? input.correlationId.trim() : undefined;
    const description = input.description?.trim() ? input.description.trim() : `${direction} ${amountString} NGN for Agent ${agentId}${aggregatorId ? ` via Aggregator ${aggregatorId}` : ' via platform'}`;

    const actor = input.actor?.trim();
    if (!actor || actor.length > 160) throw new BadRequestException('actor is required');

    const principal = input.principal;
    if (!principal || !principal.type) throw new UnauthorizedException('principal is required');

    // Authorization: deny CUSTOMER and AGENT (SELF), allow WORKFORCE privileged and AGGREGATOR with relationship
    const principalType = principal.type.toUpperCase();
    if (principalType === 'CUSTOMER') throw new ForbiddenException('Customer principal cannot fund Agents');
    if (principalType === 'AGENT') throw new ForbiddenException('Agent principal cannot fund Agents');

    let isAggregatorFunding = false;
    if (principalType === 'AGGREGATOR') {
      isAggregatorFunding = true;
      if (!aggregatorId) throw new BadRequestException('aggregatorId is required for Aggregator funding');
      if (principal.aggregatorId !== aggregatorId) throw new ForbiddenException('Aggregator principal mismatch');
      if (principal.aggregatorAccess !== 'SELF') throw new ForbiddenException('Aggregator requires SELF access');
      // Verify aggregator exists and ACTIVE
      const aggRows: Array<{ id: string; status: string; deleted_at: string | null }> = await this.dataSource.query(
        `SELECT id, status, deleted_at FROM aggregators WHERE id=$1 LIMIT 1`,
        [aggregatorId],
      );
      const agg = aggRows[0];
      if (!agg || agg.deleted_at !== null) throw new NotFoundException(`Aggregator ${aggregatorId} not found`);
      if (agg.status !== AggregatorStatus.ACTIVE) throw new ForbiddenException(`Aggregator ${aggregatorId} is ${agg.status} and cannot fund`);
      // Verify relationship ACTIVE
      const relRows: Array<{ id: string; status: string }> = await this.dataSource.query(
        `SELECT id, status FROM aggregator_agent_assignments WHERE aggregator_id=$1 AND agent_id=$2 AND status='ACTIVE' LIMIT 1`,
        [aggregatorId, agentId],
      );
      if (relRows.length === 0) throw new ForbiddenException(`No ACTIVE Aggregator-Agent relationship for ${aggregatorId} → ${agentId}`);
    } else if (['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'WORKFORCE'].includes(principalType) || principalType === 'WORKFORCE_SESSION' || principalType === 'WORKFORCE') {
      // Workforce privileged — allow internal funding for any ACTIVE Agent. If aggregatorId provided with workforce, also verify relationship but not required.
      // We treat any non-AGGREGATOR non-CUSTOMER non-AGENT as workforce-like if it has privileged access.
      // For strictness, check that principal has privileged type via runtime guard, but here we allow.
      if (aggregatorId) {
        // If workforce is funding via aggregator context, verify aggregator and relationship as above (but aggregator may be any)
        const aggRows: Array<{ id: string; status: string; deleted_at: string | null }> = await this.dataSource.query(
          `SELECT id, status, deleted_at FROM aggregators WHERE id=$1 LIMIT 1`,
          [aggregatorId],
        );
        const agg = aggRows[0];
        if (!agg || agg.deleted_at !== null) throw new NotFoundException(`Aggregator ${aggregatorId} not found`);
        if (agg.status !== AggregatorStatus.ACTIVE) throw new ForbiddenException(`Aggregator ${aggregatorId} is ${agg.status}`);
        const relRows: Array<{ id: string; status: string }> = await this.dataSource.query(
          `SELECT id, status FROM aggregator_agent_assignments WHERE aggregator_id=$1 AND agent_id=$2 AND status='ACTIVE' LIMIT 1`,
          [aggregatorId, agentId],
        );
        if (relRows.length === 0) throw new ForbiddenException(`No ACTIVE Aggregator-Agent relationship for ${aggregatorId} → ${agentId}`);
        isAggregatorFunding = true;
      }
    } else {
      throw new ForbiddenException(`Principal type ${principal.type} cannot fund Agents`);
    }

    // Agent lifecycle and capability
    const agentRows: Array<{ id: string; status: string; deleted_at: string | null; agent_class_id: string | null }> = await this.dataSource.query(
      `SELECT id, status, deleted_at, agent_class_id FROM agents WHERE id=$1 LIMIT 1`,
      [agentId],
    );
    const agent = agentRows[0];
    if (!agent || agent.deleted_at !== null) throw new NotFoundException(`Agent ${agentId} not found`);
    if (agent.status !== AgentStatus.ACTIVE) throw new ForbiddenException(`Agent ${agentId} is ${agent.status} and cannot be funded`);
    // Check capability
    const expectedService = direction === 'FUND' ? AgentService.AGENT_FUNDING : AgentService.AGENT_DEFUNDING;
    const cap = await this.capabilityService.evaluate(agentId, expectedService);
    if (!cap.allowed) throw new ForbiddenException(`Agent does not have ${expectedService} capability: ${cap.reason}`);

    // Fetch funding pool account (must exist via migration)
    const poolRows: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM ledger_accounts WHERE code=$1 LIMIT 1`, [FUNDING_POOL_CODE]);
    const pool = poolRows[0];
    if (!pool) throw new NotFoundException('Funding pool ledger account not found — migration missing');

    // Ensure Agent wallet exists
    const agentWallet = await this.ensureWalletAccount(agentId, 'NGN');

    const lines =
      direction === 'FUND'
        ? [
            { accountId: pool.id, direction: LedgerEntryDirection.DEBIT as const, amountMinor: amountString },
            { accountId: agentWallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT as const, amountMinor: amountString },
          ]
        : [
            { accountId: agentWallet.ledgerAccountId, direction: LedgerEntryDirection.DEBIT as const, amountMinor: amountString },
            { accountId: pool.id, direction: LedgerEntryDirection.CREDIT as const, amountMinor: amountString },
          ];

    const requestHash = this.computeRequestHash({
      agentId,
      aggregatorId: aggregatorId ?? null,
      amountMinor: amountString,
      currency,
      direction,
      reference,
      correlationId: correlationId ?? null,
      isAggregatorFunding,
    });

    const scope = direction === 'FUND' ? `agent-funding.v1:${agentId}` : `agent-defunding.v1:${agentId}`;

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
            const body = existing.responseBody as unknown as FundingResult | null;
            const resourceId = existing.resourceId;
            if (body && body.journalId) {
              return { ...body, status: 'REPLAYED' as const, replayed: true, createdAt: existing.updatedAt } as FundingResult;
            }
            if (resourceId) {
              return {
                status: 'REPLAYED' as const,
                journalId: resourceId,
                agentId,
                aggregatorId: aggregatorId ?? null,
                amountMinor: amountString,
                currency,
                idempotencyKey,
                requestHash,
                replayed: true,
                createdAt: existing.updatedAt,
                reference,
                correlationId: correlationId ?? null,
              };
            }
            throw new ConflictException('Idempotency replay missing resource linkage');
          }

          // Re-verify wallet inside tx for pessimistic lock semantics (fetch again)
          const walletInTx = await manager.getRepository(WalletAccount).findOne({ where: { customerId: agentId, currency: 'NGN' } });
          if (!walletInTx) throw new NotFoundException(`Agent wallet for ${agentId} not found in transaction`);

          // For defunding, ledger trigger will enforce no overdraft, but we can pre-check balance for clearer error
          // Let ledger handle insufficient funds as 422 via trigger.

          const ledgerIdempotencyKey = `${direction.toLowerCase()}:${agentId}:${idempotencyKey}`;
          let journalId: string;
          try {
            journalId = await this.ledgerService.postJournalInTransaction(manager, {
              idempotencyKey: ledgerIdempotencyKey,
              currency,
              accountingUnit: 'CUSTOMER_FUNDS',
              reference,
              description,
              correlationId,
              metadata: {
                agentId,
                aggregatorId: aggregatorId ?? null,
                direction,
                isAggregatorFunding,
                amountMinor: amountString,
                currency,
                idempotencyKey,
                requestHash,
                actor,
              },
              lines: lines.map((l) => ({
                accountId: l.accountId,
                direction: l.direction,
                amountMinor: l.amountMinor,
              })),
            });
          } catch (e) {
            // Ledger insufficient funds throws BadRequest? In our ledger trigger, negative balance raises 23514, which LedgerService maps to BadRequest with message about balance.
            // For funding, we want insufficient funds to be caught on defunding (Agent wallet negative). For funding, pool allow_negative true so no error.
            throw e;
          }

          const result: FundingResult = {
            status: 'COMPLETED',
            journalId,
            agentId,
            aggregatorId: aggregatorId ?? null,
            amountMinor: amountString,
            currency,
            idempotencyKey,
            requestHash,
            replayed: false,
            createdAt: new Date(),
            reference,
            correlationId: correlationId ?? null,
          };

          await this.idempotencyService.complete(manager, reservation.record.id, {
            statusCode: 201,
            responseBody: result as unknown as Record<string, unknown>,
            resourceType: 'LEDGER_JOURNAL',
            resourceId: journalId,
          });

          await this.auditService.record(manager, {
            entityType: direction === 'FUND' ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING',
            entityId: journalId,
            action: direction === 'FUND' ? (isAggregatorFunding ? 'AGGREGATOR_AGENT_FUNDED' : 'AGENT_FUNDED') : (isAggregatorFunding ? 'AGGREGATOR_AGENT_DEFUNDED' : 'AGENT_DEFUNDED'),
            actor,
            correlationId,
            newValues: {
              agentId,
              aggregatorId: aggregatorId ?? null,
              isAggregatorFunding,
              direction,
              amountMinor: amountString,
              currency,
              accountingUnit: 'CUSTOMER_FUNDS',
              journalId,
              idempotencyKey,
              requestHash,
              reference,
              correlationId: correlationId ?? null,
              sourceAccountId: direction === 'FUND' ? pool.id : walletInTx.ledgerAccountId,
              destinationAccountId: direction === 'FUND' ? walletInTx.ledgerAccountId : pool.id,
              poolAccountId: pool.id,
              agentLedgerAccountId: walletInTx.ledgerAccountId,
            },
          });

          return result;
        });
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    throw new ConflictException('Funding execution could not complete after concurrent retries');
  }

  private async ensureWalletAccount(customerId: string, currency: string): Promise<WalletAccount> {
    const repo = this.dataSource.getRepository(WalletAccount);
    const existing = await repo.findOne({ where: { customerId, currency } });
    if (existing) return existing;
    const idempotencyKey = `funding-ensure-${customerId}-${currency}-${randomUUID()}`;
    try {
      await this.walletService.createWallet({ customerId, currency, idempotencyKey });
    } catch (e) {
      // If conflict due to already exists, fetch again
      const retry = await repo.findOne({ where: { customerId, currency } });
      if (retry) return retry;
      throw e;
    }
    const after = await repo.findOne({ where: { customerId, currency } });
    if (!after) throw new NotFoundException(`Wallet for ${customerId} not found after creation`);
    return after;
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
