import { createHash, randomUUID } from 'node:crypto';

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
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

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

import { normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { AuditService } from '../operations/audit.service';
import { OutboxService } from '../operations/outbox.service';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { SettlementAccountService } from '../payment/settlement-account.service';
import { SettlementAccountRole } from '../payment/payment.enums';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { CustomerFundingStatus } from './customer-funding.enums';
import { CustomerFundingRequest } from './customer-funding-request.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateFundingRequestInput {
  customerId: string;
  amountMinor: string;
  currency?: string;
  externalReference?: string;
  channel?: string;
  description?: string;
  correlationId?: string;
  idempotencyKey: string;
  principal: AuthorizationPrincipal;
}

export interface ReviewFundingRequestInput {
  fundingRequestId: string;
  correlationId?: string;
  principal: AuthorizationPrincipal;
  rejectionReason?: string;
  /**
   * V1-COMMERCIAL-DECISION-03D — TEST-ONLY hook. When true on approve, the SERIALIZABLE
   * transaction throws AFTER the commercial snapshot is recorded but BEFORE commit, proving
   * that the snapshot rolls back atomically with the journal + limits + APPROVED state.
   * Never used in production code paths.
   */
  _simulateFailureAfterJournal?: boolean;
}

export interface CustomerFundingView {
  id: string;
  customerId: string;
  amountMinor: string;
  currency: string;
  status: CustomerFundingStatus;
  externalReference: string | null;
  channel: string | null;
  description: string | null;
  reference: string;
  correlationId: string | null;
  rejectionReason: string | null;
  makerId: string;
  checkerId: string | null;
  journalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
}

export interface CustomerFundingSafeHistoryView {
  id: string;
  reference: string;
  amountMinor: string;
  currency: string;
  status: CustomerFundingStatus;
  externalReference: string | null;
  channel: string | null;
  description: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
}

@Injectable()
export class CustomerFundingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly settlementAccountService: SettlementAccountService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    @Optional()
    private readonly limitEnforcementService?: LimitEnforcementService,
    // V1-COMMERCIAL-DECISION-03D — CUSTOMER_FUNDING commercial snapshot wiring.
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

  async createRequest(input: CreateFundingRequestInput): Promise<CustomerFundingView> {
    const customerId = this.assertUuid(input.customerId, 'customerId');
    const currency = normalizeCurrency(input.currency ?? 'NGN');
    if (currency !== 'NGN') throw new BadRequestException('currency must be NGN');
    const amount = parsePositiveMinorUnits(input.amountMinor, 'amountMinor');
    const amountString = amount.toString();
    const idempotencyKey = this.assertIdempotencyKey(input.idempotencyKey);
    const externalReference = this.optionalText(input.externalReference, 'externalReference', 255);
    const channel = this.optionalText(input.channel, 'channel', 64);
    const description = this.optionalText(input.description, 'description', 255);
    const correlationId = this.optionalText(input.correlationId, 'correlationId', 255);
    const principal = this.assertWorkforcePrincipal(input.principal, 'create');
    // Create allowed for SUPPORT, OPERATOR, SERVICE, PRIVILEGED
    if (!['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal.type)) {
      throw new ForbiddenException(`Principal type ${principal.type} cannot create funding requests`);
    }
    const makerId = principal.principalId;
    const makerType = principal.type;

    // Validate customer exists
    const customerRows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM customers WHERE id=$1 AND deleted_at IS NULL LIMIT 1`,
      [customerId],
    );
    if (customerRows.length === 0) throw new NotFoundException(`Customer ${customerId} was not found`);

    const requestHash = this.computeRequestHash({
      customerId,
      amountMinor: amountString,
      currency,
      externalReference: externalReference ?? null,
      channel: channel ?? null,
    });

    // SERIALIZABLE with retry — same pattern as FundingService/TransferService
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const view = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const existing: Array<{
            id: string;
            request_hash: string;
          }> = await manager.query(
            `SELECT id, request_hash FROM customer_funding_requests WHERE idempotency_key=$1 LIMIT 1`,
            [idempotencyKey],
          );
          const found = existing[0];
          if (found) {
            if (found.request_hash !== requestHash) {
              throw new ConflictException('The idempotency key was already used for another funding request');
            }
            const rows: Array<any> = await manager.query(
              `SELECT * FROM customer_funding_requests WHERE id=$1 LIMIT 1`,
              [found.id],
            );
            return this.toView(rows[0]);
          }

          const id = randomUUID();
          const reference = `CF-${id}`;
          const now = new Date();
          // Insert pending request
          await manager.query(
            `INSERT INTO customer_funding_requests
              (id, customer_id, amount_minor, currency, status, external_reference, channel, description,
               maker_id, maker_type, reference, idempotency_key, request_hash, correlation_id, created_at, updated_at, version)
             VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,1)`,
            [
              id,
              customerId,
              amountString,
              currency,
              externalReference ?? null,
              channel ?? null,
              description ?? null,
              makerId,
              makerType,
              reference,
              idempotencyKey,
              requestHash,
              correlationId ?? null,
              now,
            ],
          );

          await this.auditService.record(manager, {
            entityType: 'CUSTOMER_FUNDING_REQUEST',
            entityId: id,
            action: 'FUNDING_REQUEST_CREATED',
            actor: makerId,
            correlationId: correlationId ?? `customer-funding:${id}`,
            newValues: {
              customerId,
              amountMinor: amountString,
              currency,
              status: CustomerFundingStatus.PENDING,
              reference,
              externalReference,
              channel,
            },
          });

          await this.outboxService.enqueue(manager, {
            eventType: 'customer.funding.requested',
            aggregateType: 'CUSTOMER_FUNDING_REQUEST',
            aggregateId: id,
            correlationId: correlationId ?? `customer-funding:${id}`,
            payload: {
              fundingRequestId: id,
              customerId,
              amountMinor: amountString,
              currency,
              reference,
              externalReference,
            },
          });

          const inserted: Array<any> = await manager.query(
            `SELECT * FROM customer_funding_requests WHERE id=$1 LIMIT 1`,
            [id],
          );
          return this.toView(inserted[0]);
        });
        return view;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) continue;
        if (this.isConstraintViolation(error, 'uq_customer_funding_requests_idempotency_key')) {
          // Concurrent insert race — fetch existing and compare hash
          const rows: Array<{ request_hash: string }> = await this.dataSource.query(
            `SELECT request_hash FROM customer_funding_requests WHERE idempotency_key=$1 LIMIT 1`,
            [idempotencyKey],
          );
          const existingHash = rows[0]?.request_hash;
          if (existingHash && existingHash === requestHash) {
            const foundRows: Array<any> = await this.dataSource.query(
              `SELECT * FROM customer_funding_requests WHERE idempotency_key=$1 LIMIT 1`,
              [idempotencyKey],
            );
            return this.toView(foundRows[0]);
          }
          throw new ConflictException('The idempotency key was already used for another funding request');
        }
        throw error;
      }
    }
    throw new ConflictException('The funding request could not be created after concurrent retries');
  }

  async approve(input: ReviewFundingRequestInput): Promise<CustomerFundingView> {
    const fundingRequestId = this.assertUuid(input.fundingRequestId, 'fundingRequestId');
    const correlationId = this.optionalText(input.correlationId, 'correlationId', 255);
    const principal = this.assertWorkforcePrincipal(input.principal, 'approve');
    const checkerId = principal.principalId;
    const checkerType = principal.type;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const view = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          // Lock funding request row
          const rows: Array<any> = await manager.query(
            `SELECT * FROM customer_funding_requests WHERE id=$1 FOR UPDATE`,
            [fundingRequestId],
          );
          const request = rows[0];
          if (!request) throw new NotFoundException(`Funding request ${fundingRequestId} was not found`);
          const status: string = request.status;
          if (status !== CustomerFundingStatus.PENDING) {
            throw new ConflictException(`Funding request ${fundingRequestId} is already ${status}`);
          }
          const makerId: string = request.maker_id;
          if (makerId === checkerId) {
            throw new ForbiddenException('Maker cannot approve own funding request (maker!=checker)');
          }
          if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(checkerType)) {
            throw new ForbiddenException(`Principal type ${checkerType} cannot approve funding requests`);
          }

          const customerId: string = request.customer_id;
          const amountMinor: string = request.amount_minor.toString();
          const currency: string = request.currency;

          // Resolve customer wallet ledger account — ledger-derived, no balance column
          const walletRows: Array<{ id: string; ledger_account_id: string; status: string }> =
            await manager.query(
              `SELECT id, ledger_account_id, status FROM wallet_accounts WHERE customer_id=$1 AND currency=$2 LIMIT 1`,
              [customerId, currency],
            );
          const wallet = walletRows[0];
          if (!wallet) throw new NotFoundException(`Wallet for customer ${customerId} ${currency} was not found`);
          if (wallet.status !== 'ACTIVE') throw new ConflictException(`Wallet ${wallet.id} is ${wallet.status}`);

          // Settlement account — authoritative existing funding control account (PAYMENT-SETTLEMENT_ASSET-NGN)
          const settlementAccountId = await this.settlementAccountService.getAccountId(
            manager,
            currency,
            SettlementAccountRole.SETTLEMENT_ASSET,
          );

          // V1-LIMIT-04: enforce limits for CUSTOMER_FUNDING (CUSTOMER INCOMING)
          let limitIdempotencyKey: string | null = null;
          let limitRequestHash: string | null = null;
          // V1-COMMERCIAL-DECISION-03D: capture the AUTHORITATIVE enforcement result so the
          // commercial snapshot records what actually governed this approval — never re-evaluated.
          let limitOutcome: EnforceResult | null = null;
          if (this.limitEnforcementService) {
            limitIdempotencyKey = `customer-funding-approve:${fundingRequestId}`;
            limitRequestHash = createHash('sha256')
              .update(
                this.canonicalJson({
                  fundingRequestId,
                  customerId,
                  amountMinor,
                  currency,
                  walletLedgerAccountId: wallet.ledger_account_id,
                }),
              )
              .digest('hex');
            try {
              limitOutcome = await this.limitEnforcementService.enforceWithManager(manager, {
                principalType: 'CUSTOMER',
                principalId: customerId,
                product: 'CUSTOMER_FUNDING',
                currency,
                direction: 'INCOMING',
                channel: null,
                amountMinor,
                idempotencyKey: limitIdempotencyKey,
                requestHash: limitRequestHash,
                correlationId: correlationId ?? null,
                now: new Date(),
                walletLedgerAccountId: wallet.ledger_account_id,
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

          const reference: string = request.reference;
          const ledgerIdempotencyKey = `customer-funding:${fundingRequestId}`;
          const ledgerRequestHash = createHash('sha256')
            .update(
              this.canonicalJson({
                fundingRequestId,
                customerId,
                amountMinor,
                currency,
                settlementAccountId,
                walletLedgerAccountId: wallet.ledger_account_id,
              }),
            )
            .digest('hex');

          let journalId: string;
          try {
            journalId = await this.ledgerService.postJournalInTransaction(manager, {
              idempotencyKey: ledgerIdempotencyKey,
              currency,
              accountingUnit: 'CUSTOMER_FUNDS',
              reference,
              description: request.description?.trim()
                ? request.description.trim()
                : `Customer funding ${reference} ${amountMinor} NGN`,
              correlationId: correlationId ?? `customer-funding:${fundingRequestId}`,
              metadata: {
                fundingRequestId,
                customerId,
                amountMinor,
                externalReference: request.external_reference,
              },
              lines: [
                {
                  accountId: settlementAccountId,
                  direction: LedgerEntryDirection.DEBIT,
                  amountMinor,
                },
                {
                  accountId: wallet.ledger_account_id,
                  direction: LedgerEntryDirection.CREDIT,
                  amountMinor,
                },
              ],
            });
          } catch (error) {
            // Journal idempotency: if same fundingRequestId already has journal with same hash, return existing
            if (
              error instanceof ConflictException &&
              (error.message.includes('idempotency key was already used') ||
                error.message.includes('already used for another journal'))
            ) {
              const jRows: Array<{ id: string; request_hash: string }> = await manager.query(
                `SELECT id, request_hash FROM ledger_journals WHERE idempotency_key=$1 LIMIT 1`,
                [ledgerIdempotencyKey],
              );
              const existing = jRows[0];
              if (existing && existing.request_hash === ledgerRequestHash) {
                journalId = existing.id;
                if (limitIdempotencyKey && this.limitEnforcementService) {
                  try {
                    await this.limitEnforcementService.commitReservationsWithManager(manager, limitIdempotencyKey);
                  } catch {}
                }
              } else {
                if (limitIdempotencyKey && this.limitEnforcementService) {
                  try {
                    await this.limitEnforcementService.releaseReservationsWithManager(manager, limitIdempotencyKey);
                  } catch {}
                }
                throw error;
              }
            } else {
              if (limitIdempotencyKey && this.limitEnforcementService) {
                try {
                  await this.limitEnforcementService.releaseReservationsWithManager(manager, limitIdempotencyKey);
                } catch {}
              }
              throw error;
            }
          }

          if (limitIdempotencyKey && this.limitEnforcementService) {
            try {
              await this.limitEnforcementService.commitReservationsWithManager(manager, limitIdempotencyKey);
            } catch {}
          }

          const now = new Date();
          await manager.query(
            `UPDATE customer_funding_requests
                SET status='APPROVED', journal_id=$1, checker_id=$2, checker_type=$3, approved_at=$4, updated_at=$4, version=version+1
              WHERE id=$5`,
            [journalId, checkerId, checkerType, now, fundingRequestId],
          );

          // — V1-COMMERCIAL-DECISION-03D: record the immutable commercial decision snapshot inside
          // this same SERIALIZABLE approve transaction, after the journal posted, limits committed
          // and the request flipped to APPROVED (the actual financial/commercial decision — NOT
          // request creation, NOT rejection). Commits/rolls back atomically with the funding
          // credit. NO fee is charged: NOT_CONFIGURED.
          await this.recordCommercialDecisionSnapshot(manager, {
            fundingRequestId,
            customerId,
            amountMinor,
            currency,
            journalId,
            makerId,
            checkerId,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            correlationId: correlationId ?? request.correlation_id ?? null,
            limitOutcome,
          });

          // Simulate failure after journal for rollback test (inside same transaction, so journal,
          // limits, APPROVED state, and snapshot all roll back)
          if (input._simulateFailureAfterJournal) {
            throw new BadRequestException('Simulated failure after journal');
          }

          await this.auditService.record(manager, {
            entityType: 'CUSTOMER_FUNDING_REQUEST',
            entityId: fundingRequestId,
            action: 'FUNDING_REQUEST_APPROVED',
            actor: checkerId,
            correlationId: correlationId ?? `customer-funding:${fundingRequestId}`,
            newValues: {
              status: CustomerFundingStatus.APPROVED,
              journalId,
              checkerId,
              amountMinor,
            },
          });

          await this.outboxService.enqueue(manager, {
            eventType: 'customer.funding.approved',
            aggregateType: 'CUSTOMER_FUNDING_REQUEST',
            aggregateId: fundingRequestId,
            correlationId: correlationId ?? `customer-funding:${fundingRequestId}`,
            payload: {
              fundingRequestId,
              customerId,
              journalId,
              amountMinor,
              currency,
              reference,
            },
          });

          const updated: Array<any> = await manager.query(
            `SELECT * FROM customer_funding_requests WHERE id=$1 LIMIT 1`,
            [fundingRequestId],
          );
          return this.toView(updated[0]);
        });
        return view;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('The funding request could not be approved after concurrent retries');
  }

  async reject(input: ReviewFundingRequestInput): Promise<CustomerFundingView> {
    const fundingRequestId = this.assertUuid(input.fundingRequestId, 'fundingRequestId');
    const correlationId = this.optionalText(input.correlationId, 'correlationId', 255);
    const rejectionReason = this.optionalText(input.rejectionReason, 'rejectionReason', 500);
    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new BadRequestException('rejectionReason is required for rejection');
    }
    const principal = this.assertWorkforcePrincipal(input.principal, 'reject');
    const checkerId = principal.principalId;
    const checkerType = principal.type;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const view = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          const rows: Array<any> = await manager.query(
            `SELECT * FROM customer_funding_requests WHERE id=$1 FOR UPDATE`,
            [fundingRequestId],
          );
          const request = rows[0];
          if (!request) throw new NotFoundException(`Funding request ${fundingRequestId} was not found`);
          const status: string = request.status;
          if (status !== CustomerFundingStatus.PENDING) {
            throw new ConflictException(`Funding request ${fundingRequestId} is already ${status}`);
          }
          const makerId: string = request.maker_id;
          if (makerId === checkerId) {
            throw new ForbiddenException('Maker cannot reject own funding request (maker!=checker)');
          }
          if (!['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(checkerType)) {
            throw new ForbiddenException(`Principal type ${checkerType} cannot reject funding requests`);
          }

          const now = new Date();
          await manager.query(
            `UPDATE customer_funding_requests
                SET status='REJECTED', checker_id=$1, checker_type=$2, rejected_at=$3, rejection_reason=$4, updated_at=$3, version=version+1
              WHERE id=$5`,
            [checkerId, checkerType, now, rejectionReason.trim(), fundingRequestId],
          );

          await this.auditService.record(manager, {
            entityType: 'CUSTOMER_FUNDING_REQUEST',
            entityId: fundingRequestId,
            action: 'FUNDING_REQUEST_REJECTED',
            actor: checkerId,
            correlationId: correlationId ?? `customer-funding:${fundingRequestId}`,
            newValues: {
              status: CustomerFundingStatus.REJECTED,
              rejectionReason: rejectionReason.trim(),
              checkerId,
            },
          });

          await this.outboxService.enqueue(manager, {
            eventType: 'customer.funding.rejected',
            aggregateType: 'CUSTOMER_FUNDING_REQUEST',
            aggregateId: fundingRequestId,
            correlationId: correlationId ?? `customer-funding:${fundingRequestId}`,
            payload: {
              fundingRequestId,
              customerId: request.customer_id,
              rejectionReason: rejectionReason.trim(),
              reference: request.reference,
            },
          });

          const updated: Array<any> = await manager.query(
            `SELECT * FROM customer_funding_requests WHERE id=$1 LIMIT 1`,
            [fundingRequestId],
          );
          return this.toView(updated[0]);
        });
        return view;
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('The funding request could not be rejected after concurrent retries');
  }

  async getById(fundingRequestId: string): Promise<CustomerFundingView> {
    const id = this.assertUuid(fundingRequestId, 'fundingRequestId');
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM customer_funding_requests WHERE id=$1 LIMIT 1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException(`Funding request ${id} was not found`);
    return this.toView(rows[0]);
  }

  async listForCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: CustomerFundingSafeHistoryView[]; pagination: any }> {
    const cid = this.assertUuid(customerId, 'customerId');
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM customer_funding_requests WHERE customer_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [cid, normalizedLimit, offset],
    );
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM customer_funding_requests WHERE customer_id=$1`,
      [cid],
    );
    const total = Number(countRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);
    return {
      items: rows.map((r) => this.toSafeHistoryView(r)),
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  async listInternal(customerId?: string): Promise<CustomerFundingView[]> {
    if (customerId) {
      const cid = this.assertUuid(customerId, 'customerId');
      const rows: Array<any> = await this.dataSource.query(
        `SELECT * FROM customer_funding_requests WHERE customer_id=$1 ORDER BY created_at DESC, id DESC`,
        [cid],
      );
      return rows.map((r) => this.toView(r));
    }
    const rows: Array<any> = await this.dataSource.query(
      `SELECT * FROM customer_funding_requests ORDER BY created_at DESC, id DESC LIMIT 100`,
    );
    return rows.map((r) => this.toView(r));
  }

  /**
   * V1-COMMERCIAL-DECISION-03D — CUSTOMER_FUNDING commercial snapshot capture.
   *
   * Runs inside the existing SERIALIZABLE approve transaction via
   * `recordDecisionWithManager` (never `recordDecision`, which opens its own transaction).
   * Read-only fee resolution via `FeeRuleResolverService.resolveWithManager` participates in the
   * same transaction; its result is EVIDENCE ONLY — no fee is calculated or charged and the
   * ledger is untouched by this method. Mirrors the proven pilot semantics:
   *  - fee decision stays NOT_CONFIGURED while V1 is fee-free (never ZERO); resolved rule
   *    evidence (ruleId/ruleVersion/effective parameters) is captured in fee_decision.ruleRefs
   *  - commission/reward NONE, revenue null, configurationVersion null — nothing invented
   *  - limit evidence comes from the authoritative EnforceResult of THIS approval
   *    (CUSTOMER INCOMING — never re-evaluated)
   *  - the snapshot represents the APPROVAL financial execution (the funded Customer is the
   *    economic principal); request creation and rejection never produce a snapshot
   */
  private async recordCommercialDecisionSnapshot(
    manager: EntityManager,
    ctx: {
      fundingRequestId: string;
      customerId: string;
      amountMinor: string;
      currency: string;
      journalId: string;
      makerId: string;
      checkerId: string;
      correlationId: string | null;
      limitOutcome: EnforceResult | null;
    },
  ): Promise<void> {
    if (!this.feeRuleResolverService || !this.commercialDecisionSnapshotService) return;
    if (!UUID_PATTERN.test(ctx.customerId)) return;

    const productCode = 'CUSTOMER_FUNDING';
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
      // flow evidence (allowed by the snapshot's jsonb contract): request identity + the
      // maker/checker separation that authorized the financial decision
      fundingRequestId: ctx.fundingRequestId,
      makerId: ctx.makerId,
      checkerId: ctx.checkerId,
      };
    } else {
      feeDecision = {
        ...feeNotConfigured(ctx.currency, ctx.amountMinor),
        // flow evidence (allowed by the snapshot's jsonb contract): request identity + the
        // maker/checker separation that authorized the financial decision
        fundingRequestId: ctx.fundingRequestId,
        makerId: ctx.makerId,
        checkerId: ctx.checkerId,
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
      idempotencyKey: `customer-funding:${ctx.fundingRequestId}`,
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
      createdBy: 'customer-funding',
    });
  }

  private toView(row: any): CustomerFundingView {
    return {
      id: row.id,
      customerId: row.customer_id,
      amountMinor: row.amount_minor.toString(),
      currency: row.currency,
      status: row.status as CustomerFundingStatus,
      externalReference: row.external_reference ?? null,
      channel: row.channel ?? null,
      description: row.description ?? null,
      reference: row.reference,
      correlationId: row.correlation_id ?? null,
      rejectionReason: row.rejection_reason ?? null,
      makerId: row.maker_id,
      checkerId: row.checker_id ?? null,
      journalId: row.journal_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvedAt: row.approved_at ?? null,
      rejectedAt: row.rejected_at ?? null,
    };
  }

  private toSafeHistoryView(row: any): CustomerFundingSafeHistoryView {
    // SAFE projection — no journalId, ledger ids, hashes, idempotency, maker/checker internal security details beyond reference/status
    return {
      id: row.id,
      reference: row.reference,
      amountMinor: row.amount_minor.toString(),
      currency: row.currency,
      status: row.status as CustomerFundingStatus,
      externalReference: row.external_reference ?? null,
      channel: row.channel ?? null,
      description: row.description ?? null,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? null,
      rejectedAt: row.rejected_at ?? null,
      rejectionReason: row.rejection_reason ?? null,
    };
  }

  private computeRequestHash(params: {
    customerId: string;
    amountMinor: string;
    currency: string;
    externalReference: string | null;
    channel: string | null;
  }): string {
    return createHash('sha256')
      .update(this.canonicalJson(params))
      .digest('hex');
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

  private assertUuid(value: string, fieldName: string): string {
    const v = value?.trim();
    if (!v || !UUID_PATTERN.test(v)) throw new BadRequestException(`${fieldName} must be a UUID`);
    return v;
  }

  private assertIdempotencyKey(value: string): string {
    const v = value?.trim();
    if (!v || v.length > 255) throw new BadRequestException('Idempotency-Key header is required and must be at most 255 characters');
    return v;
  }

  private optionalText(value: string | undefined | null, fieldName: string, maxLen: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    const v = value.trim();
    if (v.length === 0) return undefined;
    if (v.length > maxLen) throw new BadRequestException(`${fieldName} must be at most ${maxLen} characters`);
    return v;
  }

  private normalizePage(page: number): number {
    if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
    return page;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be between 1 and 100');
    return limit;
  }

  private assertWorkforcePrincipal(principal: AuthorizationPrincipal | undefined, action: string): AuthorizationPrincipal {
    if (!principal || !principal.type) throw new UnauthorizedException('Authentication required');
    if (!principal.principalId) throw new UnauthorizedException('Principal is invalid');
    return principal;
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }

  private isConstraintViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { constraint?: string; code?: string };
    return driverError.code === '23505' && driverError.constraint === constraintName;
  }
}
