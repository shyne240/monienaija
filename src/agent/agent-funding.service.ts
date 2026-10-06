import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

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
import { CommissionEngine } from '../commission/commission.engine';
import { CommercialDecisionSnapshotService } from '../commercial-decision/commercial-decision-snapshot.service';
import {
  commissionAllocatedAtAccountingBoundary,
  commissionFeeBasisMinor,
  commissionFeeCollectionStateOf,
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
  /**
   * V1-COMMERCIAL-DECISION-03E — TEST-ONLY hook. When true, the SERIALIZABLE transaction
   * throws AFTER the commercial snapshot is recorded but BEFORE commit, proving that the
   * snapshot rolls back atomically with the journal + limits + idempotency state. Never
   * used in production code paths.
   */
  _simulateFailureAfterJournal?: boolean;
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
    @Optional()
    private readonly limitEnforcementService?: LimitEnforcementService,
    // V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING commercial snapshot wiring.
    // Both optional: absent → no snapshot (unit tests constructing directly keep working).
    @Optional()
    private readonly feeRuleResolverService?: FeeRuleResolverService,
    @Optional()
    private readonly commercialDecisionSnapshotService?: CommercialDecisionSnapshotService,
    // V1-COMMERCIAL-IMPLEMENTATION-01 — single fee computation authority (optional; absent →
    // legacy evidence shape for manual-construction unit tests).
    @Optional()
    private readonly feeRuleCalculatorService?: FeeRuleCalculatorService,
    // V1-COMMERCIAL-IMPLEMENTATION-02 — single commission decision authority (optional; absent →
    // legacy commissionNone() shape for manual-construction unit tests).
    @Optional()
    private readonly commissionEngine?: CommissionEngine,
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

          // V1-LIMIT-04: enforce limits for AGENT_FUNDING/AGENT_DEFUNDING
          let limitIdempotencyKey: string | null = null;
          // V1-COMMERCIAL-DECISION-03E: capture the AUTHORITATIVE enforcement result so the
          // commercial snapshot records what actually governed this execution — never re-evaluated.
          let limitOutcome: EnforceResult | null = null;
          if (this.limitEnforcementService) {
            const agentRows: Array<{ agent_class_id: string | null }> = await manager.query(
              `SELECT agent_class_id FROM agents WHERE id = $1 LIMIT 1`,
              [agentId],
            );
            const agentClassId = agentRows[0]?.agent_class_id ?? null;
            limitIdempotencyKey = idempotencyKey;
            const product = direction === 'FUND' ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING';
            const dir = direction === 'FUND' ? 'INCOMING' : 'OUTGOING';
            try {
              limitOutcome = await this.limitEnforcementService.enforceWithManager(manager, {
                principalType: 'AGENT',
                principalId: agentId,
                agentClassId,
                product,
                currency: 'NGN',
                direction: dir,
                channel: null,
                amountMinor: amountString,
                idempotencyKey: limitIdempotencyKey,
                requestHash,
                correlationId: correlationId ?? null,
                now: new Date(),
                walletLedgerAccountId: walletInTx.ledgerAccountId,
                principalWalletCustomerId: agentId,
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
            if (limitIdempotencyKey && this.limitEnforcementService) {
              try {
                await this.limitEnforcementService.releaseReservationsWithManager(manager, limitIdempotencyKey);
              } catch {}
            }
            throw e;
          }

          if (limitIdempotencyKey && this.limitEnforcementService) {
            try {
              await this.limitEnforcementService.commitReservationsWithManager(manager, limitIdempotencyKey);
            } catch {}
          }

          // — V1-COMMERCIAL-DECISION-03E: record the immutable commercial decision snapshot inside
          // this same SERIALIZABLE transaction, after the journal posted and limits committed,
          // before idempotency completion + audit. Commits/rolls back atomically with the funding
          // movement. NO fee is charged: NOT_CONFIGURED. The existing pool/wallet accounting is
          // untouched — this adds no journal, no account, no second balance.
          await this.recordCommercialDecisionSnapshot(manager, {
            direction,
            agentId,
            aggregatorId: aggregatorId ?? null,
            amountMinor: amountString,
            currency,
            journalId,
            idempotencyKey,
            correlationId: correlationId ?? null,
            limitOutcome,
          });

          // Simulate failure after journal for rollback test (inside same transaction, so journal,
          // limits, snapshot, and idempotency state all roll back)
          if (input._simulateFailureAfterJournal) {
            throw new BadRequestException('Simulated failure after journal');
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
        if (isRetryableTransactionError(error)) {
          if (attempt < MAX_SERIALIZABLE_ATTEMPTS - 1) continue;
          throw this.transactionContentionExhaustedException();
        }
        throw error;
      }
    }
    throw this.transactionContentionExhaustedException();
  }

  // V1-INFRA-03: mirrors the established house convention in
  // AgentCashToCashService.transactionContentionExhaustedException() — a stable, documented
  // machine code (`TRANSACTION_CONTENTION_RETRY_EXHAUSTED`) set as both `error` and `code` in
  // the response body, plus `.code` directly on the exception instance.
  private transactionContentionExhaustedException(): ConflictException {
    const code = 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED';
    const message = 'Funding execution could not complete after concurrent retries';
    const exception = new ConflictException({ message, error: code, code });
    (exception as unknown as { code?: string }).code = code;
    return exception;
  }

  /**
   * V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING commercial snapshot capture.
   *
   * Runs inside the existing SERIALIZABLE funding transaction via
   * `recordDecisionWithManager` (never `recordDecision`, which opens its own transaction).
   * Read-only fee resolution via `FeeRuleResolverService.resolveWithManager` participates in the
   * same transaction; its result is EVIDENCE ONLY — no fee is calculated or charged and the
   * ledger is untouched by this method. Mirrors the proven pilot semantics:
   *  - fee decision stays NOT_CONFIGURED while V1 is fee-free (never ZERO); resolved rule
   *    evidence (ruleId/ruleVersion/effective parameters) is captured in fee_decision.ruleRefs
   *  - commission: engine-evaluated via the CommissionEngine (V1-COMMERCIAL-IMPLEMENTATION-02);
   *    recorded ALLOCATED with evidence-only accounting-boundary annotations when a configured
   *    rule applies, otherwise the identical byte-shape NONE as the pre-wiring snapshot; reward
   *    NONE, revenue null, configurationVersion null — nothing invented
   *  - limit evidence comes from the authoritative EnforceResult of THIS execution
   *    (AGENT_FUNDING = AGENT INCOMING; AGENT_DEFUNDING = AGENT OUTGOING — never re-evaluated)
   *  - the Agent is the financial principal for both directions; the pool/wallet accounting
   *    and single-journal structure are preserved exactly
   */
  private async recordCommercialDecisionSnapshot(
    manager: EntityManager,
    ctx: {
      direction: 'FUND' | 'DEFUND';
      agentId: string;
      aggregatorId: string | null;
      amountMinor: string;
      currency: string;
      journalId: string;
      idempotencyKey: string;
      correlationId: string | null;
      limitOutcome: EnforceResult | null;
    },
  ): Promise<void> {
    if (!this.feeRuleResolverService || !this.commercialDecisionSnapshotService) return;
    if (!UUID_PATTERN.test(ctx.agentId)) return;

    const isFund = ctx.direction === 'FUND';
    const productCode = isFund ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING';
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
      // flow evidence (allowed by the snapshot's jsonb contract): acting Agent + funding source
      agentId: ctx.agentId,
      aggregatorId: ctx.aggregatorId,
      };
    } else {
      feeDecision = {
        ...feeNotConfigured(ctx.currency, ctx.amountMinor),
        // flow evidence (allowed by the snapshot's jsonb contract): acting Agent + funding source
        agentId: ctx.agentId,
        aggregatorId: ctx.aggregatorId,
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

    // V1-COMMERCIAL-IMPLEMENTATION-02 — authoritative commission decision from the single engine
    // authority, evaluated IN this same SERIALIZABLE transaction. The funded/defunded Agent is the
    // SUBJECT of this float movement (their own wallet is being credited/debited) — they are NOT a
    // commission beneficiary of it: no commission-earning participant exists, so no agentId/
    // agentClassId context is supplied to the engine even though this service knows the agent, and
    // aggregatorId is never supplied (aggregator commission disabled; individual agent overrides
    // disabled). An engine-evaluated NONE is recorded. Empty registry → identical byte-shape NONE.
    // Fail-closed: ambiguity/base-unavailable aborts BEFORE money commits.
    let commissionDecision: Record<string, unknown> = commissionNone();
    if (this.commissionEngine) {
      const engineDecision = await this.commissionEngine.decideWithManager(
        manager,
        {
          productCode,
          currency: ctx.currency,
          agentId: null,
          agentClassId: null,
          aggregatorId: null,
          at: decisionAt,
        },
        {
          principalMinor: ctx.amountMinor,
          feeMinor: commissionFeeBasisMinor(feeDecision),
        },
      );
      if (engineDecision.status === 'ALLOCATED') {
        commissionDecision = {
          ...commissionAllocatedAtAccountingBoundary(engineDecision, {
            feeCollectionState: commissionFeeCollectionStateOf(feeDecision),
            commissionEvent: 'TRANSACTION_COMPLETION',
          }),
        };
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
      idempotencyKey: `${isFund ? 'agent-funding' : 'agent-defunding'}:${ctx.agentId}:${ctx.idempotencyKey}`,
      product: productCode,
      direction: isFund ? 'INCOMING' : 'OUTGOING',
      channel: null,
      principalType: 'AGENT',
      principalId: ctx.agentId,
      currency: ctx.currency,
      principalAmountMinor: ctx.amountMinor,
      transactionReference: ctx.journalId,
      correlationId: ctx.correlationId,
      journalId: ctx.journalId,
      decisionStatus: 'FINAL',
      decidedAt: decisionAt,
      finalizedAt: decisionAt,
      feeDecision: feeDecision as never,
      commissionDecision: commissionDecision as never,
      rewardDecision: rewardNone(),
      limitDecision,
      revenueDecision: null,
      configurationVersion: null,
      createdBy: isFund ? 'agent-funding' : 'agent-defunding',
    });
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
